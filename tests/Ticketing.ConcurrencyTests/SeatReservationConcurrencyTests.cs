using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Ticketing.Application;
using Ticketing.Domain;
using Ticketing.Infrastructure;
using Xunit;

namespace Ticketing.ConcurrencyTests;

internal sealed class NoOpSeatAvailabilityNotifier : ISeatAvailabilityNotifier
{
    public Task SeatStatusChangedAsync(Guid eventId, Guid seatId, SeatStatus status, CancellationToken cancellationToken)
        => Task.CompletedTask;
}

/// <summary>
/// Proves ADR-0002's core correctness claim — "two buyers can never both successfully reserve the
/// same seat" — against a REAL PostgreSQL instance, not an in-memory provider (which wouldn't
/// exercise the row-level MVCC write-lock behavior the ADR's guarantee actually depends on).
///
/// Environment note: this sandbox has no Docker daemon available for Testcontainers, so the test
/// targets a locally installed PostgreSQL 16 instance via a plain connection string instead of a
/// container. The mechanism under test — EF Core's ExecuteUpdateAsync compiling to one atomic
/// conditional `UPDATE ... WHERE ...` statement — is identical regardless of which real Postgres
/// instance runs it; a container wasn't load-bearing for what this test actually proves.
///
/// Each concurrent "request" gets its OWN DbContext/connection (never sharing one across threads —
/// DbContext isn't thread-safe), exactly mirroring how ASP.NET Core gives each real HTTP request
/// its own scoped DbContext in production.
/// </summary>
public sealed class SeatReservationConcurrencyTests : IAsyncLifetime
{
    // No password embedded here on purpose — read at runtime from ~/.pgpass (never committed) the
    // same way libpq/psql resolve local credentials; Npgsql's own `Passfile` connection parameter
    // didn't successfully authenticate in this environment, so it's parsed by hand instead.
    // Override entirely via TICKETING_TEST_CONNECTION_STRING for a CI environment with its own
    // Postgres/credentials.
    private static readonly string ConnectionString = Environment.GetEnvironmentVariable("TICKETING_TEST_CONNECTION_STRING")
        ?? $"Host=localhost;Port=5432;Database=ticketing_concurrency_test;Username=postgres;Password={ResolvePgPassPassword()}";

    private static string ResolvePgPassPassword()
    {
        var path = Path.Combine(Environment.GetEnvironmentVariable("HOME") ?? "", ".pgpass");
        if (!File.Exists(path))
        {
            throw new InvalidOperationException($"{path} not found — set TICKETING_TEST_CONNECTION_STRING instead, or add a ~/.pgpass entry for localhost:5432:*:postgres:<password>.");
        }

        foreach (var line in File.ReadAllLines(path))
        {
            var parts = line.Split(':');
            if (parts.Length == 5 && (parts[0] == "localhost" || parts[0] == "*") && parts[3] == "postgres")
            {
                return parts[4];
            }
        }

        throw new InvalidOperationException($"No localhost:5432:*:postgres:<password> entry found in {path}.");
    }

    public async Task InitializeAsync()
    {
        await using var db = CreateDbContext();
        await db.Database.EnsureDeletedAsync();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task DisposeAsync()
    {
        await using var db = CreateDbContext();
        await db.Database.EnsureDeletedAsync();
    }

    private static TicketingDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<TicketingDbContext>().UseNpgsql(ConnectionString).Options;
        return new TicketingDbContext(options);
    }

    [Fact]
    public async Task N_concurrent_reservation_attempts_on_the_SAME_seat_yield_exactly_one_success_and_N_minus_1_failures()
    {
        const int concurrentAttempts = 50;

        var eventId = Guid.NewGuid();
        var seatId = Guid.NewGuid();

        await using (var seedDb = CreateDbContext())
        {
            seedDb.Seats.Add(new Seat(seatId, eventId, "A1", "A", 1));
            await seedDb.SaveChangesAsync();
        }

        var buyerIds = Enumerable.Range(0, concurrentAttempts).Select(_ => Guid.NewGuid()).ToArray();

        // Synchronizes all N attempts to actually race against Postgres at (as close to) the same
        // instant as the OS scheduler allows, rather than trickling in near-sequentially — the
        // whole point is proving the guarantee holds under genuine concurrent contention.
        using var barrier = new Barrier(concurrentAttempts);

        var tasks = buyerIds.Select(buyerId => Task.Run(async () =>
        {
            await using var db = CreateDbContext();
            var store = new SeatStore(db);
            var service = new SeatReservationService(store, new NoOpSeatAvailabilityNotifier(), Options.Create(new TicketingOptions()));

            barrier.SignalAndWait();

            return await service.ReserveAsync(new ReserveSeatRequest(eventId, seatId, buyerId), CancellationToken.None);
        }));

        var results = await Task.WhenAll(tasks);

        var successes = results.Count(r => r.Success);
        var failures = results.Count(r => !r.Success);

        // The entire test, in two numbers: never zero, never two-or-more.
        Assert.Equal(1, successes);
        Assert.Equal(concurrentAttempts - 1, failures);

        // Directly against Postgres too: exactly one row, RESERVED, holding exactly the winning
        // reservation id — not just "the counts add up" but "the actual data is unambiguous."
        await using var verifyDb = CreateDbContext();
        var seat = await verifyDb.Seats.AsNoTracking().SingleAsync(s => s.Id == seatId);
        Assert.Equal(SeatStatus.Reserved, seat.Status);

        var winningReservationId = results.Single(r => r.Success).ReservationId;
        Assert.Equal(winningReservationId, seat.ReservationId);
    }

    [Fact]
    public async Task After_the_winning_reservation_expires_a_new_attempt_can_reclaim_the_seat_but_still_only_one_winner()
    {
        var eventId = Guid.NewGuid();
        var seatId = Guid.NewGuid();

        await using (var seedDb = CreateDbContext())
        {
            seedDb.Seats.Add(new Seat(seatId, eventId, "B1", "B", 1));
            await seedDb.SaveChangesAsync();
        }

        await using (var db = CreateDbContext())
        {
            var store = new SeatStore(db);
            // Reserve with an already-expired TTL, simulating a reservation nobody completed in time.
            var affected = await store.TryReserveAsync(seatId, Guid.NewGuid(), Guid.NewGuid(), DateTime.UtcNow.AddMinutes(-1), CancellationToken.None);
            Assert.Equal(1, affected);
        }

        const int concurrentAttempts = 20;
        var buyerIds = Enumerable.Range(0, concurrentAttempts).Select(_ => Guid.NewGuid()).ToArray();
        using var barrier = new Barrier(concurrentAttempts);

        var tasks = buyerIds.Select(buyerId => Task.Run(async () =>
        {
            await using var db = CreateDbContext();
            var service = new SeatReservationService(new SeatStore(db), new NoOpSeatAvailabilityNotifier(), Options.Create(new TicketingOptions()));
            barrier.SignalAndWait();
            return await service.ReserveAsync(new ReserveSeatRequest(eventId, seatId, buyerId), CancellationToken.None);
        }));

        var results = await Task.WhenAll(tasks);

        // The lazy expiry check in TryReserveAsync's WHERE clause (ADR-0002) reclaims the seat —
        // but reclaiming it is itself just another race, and the same guarantee applies: exactly
        // one winner, even though the seat started this round already RESERVED (by an expired hold).
        Assert.Equal(1, results.Count(r => r.Success));
        Assert.Equal(concurrentAttempts - 1, results.Count(r => !r.Success));
    }
}
