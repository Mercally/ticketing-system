using Microsoft.EntityFrameworkCore;
using Ticketing.Infrastructure;
using TicketingPlatform.Idempotency;
using Xunit;

namespace Ticketing.ConcurrencyTests;

/// <summary>
/// ADR-0006's "UNIQUE constraint as last line of defense" against a real Postgres instance —
/// the same real-concurrency-against-real-Postgres philosophy as
/// <see cref="SeatReservationConcurrencyTests"/>, applied to idempotency keys instead of seats.
/// Uses the same connection-resolution helper (see that class for the environment note on why
/// this targets a local Postgres instance rather than a Testcontainers container).
/// </summary>
public sealed class EfIdempotencyStoreTests : IAsyncLifetime
{
    private static readonly string ConnectionString = Environment.GetEnvironmentVariable("TICKETING_TEST_CONNECTION_STRING")
        ?? $"Host=localhost;Port=5432;Database=ticketing_idempotency_test;Username=postgres;Password={ResolvePgPassPassword()}";

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

    private static string ResolvePgPassPassword()
    {
        var path = Path.Combine(Environment.GetEnvironmentVariable("HOME") ?? "", ".pgpass");
        if (!File.Exists(path))
        {
            throw new InvalidOperationException($"{path} not found — set TICKETING_TEST_CONNECTION_STRING instead.");
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

    [Fact]
    public async Task First_call_inserts_pending_then_Complete_makes_the_stored_response_findable()
    {
        await using var db = CreateDbContext();
        var store = new EfIdempotencyStore(db);

        var inserted = await store.TryInsertPendingAsync("POST /reservations", "key-1", "hash-1", DateTime.UtcNow.AddHours(24), CancellationToken.None);
        Assert.True(inserted);

        var beforeComplete = await store.FindAsync("POST /reservations", "key-1", CancellationToken.None);
        Assert.NotNull(beforeComplete);
        Assert.Null(beforeComplete!.ResponseBody); // still "in flight" per ADR-0006

        await store.CompleteAsync("POST /reservations", "key-1", 201, "{\"reservationId\":\"abc\"}", "application/json", CancellationToken.None);

        var afterComplete = await store.FindAsync("POST /reservations", "key-1", CancellationToken.None);
        Assert.NotNull(afterComplete);
        Assert.Equal(201, afterComplete!.StatusCode);
        Assert.Equal("{\"reservationId\":\"abc\"}", afterComplete.ResponseBody);
    }

    [Fact]
    public async Task N_concurrent_TryInsertPendingAsync_calls_for_the_SAME_key_yield_exactly_one_winner()
    {
        const int concurrentAttempts = 30;
        const string endpoint = "POST /orders";
        const string key = "same-idempotency-key-raced";

        using var barrier = new Barrier(concurrentAttempts);

        var tasks = Enumerable.Range(0, concurrentAttempts).Select(_ => Task.Run(async () =>
        {
            await using var db = CreateDbContext();
            var store = new EfIdempotencyStore(db);

            barrier.SignalAndWait();

            return await store.TryInsertPendingAsync(endpoint, key, "same-request-hash", DateTime.UtcNow.AddHours(24), CancellationToken.None);
        }));

        var results = await Task.WhenAll(tasks);

        // Exactly the same shape of guarantee as the seat reservation race: never zero winners
        // (the key must end up stored), never more than one (that would mean the UNIQUE
        // constraint failed to do its job and two concurrent requests both think they're "first").
        Assert.Equal(1, results.Count(r => r));
        Assert.Equal(concurrentAttempts - 1, results.Count(r => !r));

        await using var verifyDb = CreateDbContext();
        var rowCount = await verifyDb.IdempotencyKeys.CountAsync(k => k.Endpoint == endpoint && k.Key == key);
        Assert.Equal(1, rowCount);
    }
}
