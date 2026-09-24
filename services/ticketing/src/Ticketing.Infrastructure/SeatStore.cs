using Microsoft.EntityFrameworkCore;
using Ticketing.Application;
using Ticketing.Domain;

namespace Ticketing.Infrastructure;

/// <summary>
/// The seat-consistency mechanism from ADR-0002, implemented for real: every mutating method is
/// exactly one EF Core ExecuteUpdateAsync call, which compiles to a single atomic
/// "UPDATE ... WHERE ..." statement executed server-side by Postgres — no row is ever loaded into
/// memory, mutated, and saved back. The returned affected-row count (0 or 1) is the entire
/// concurrency decision.
/// </summary>
public sealed class SeatStore(TicketingDbContext db) : ISeatStore
{
    public async Task<IReadOnlyList<Seat>> ListByEventAsync(Guid eventId, CancellationToken cancellationToken)
        => await db.Seats.AsNoTracking().Where(s => s.EventId == eventId).ToListAsync(cancellationToken);

    public async Task<Seat?> GetAsync(Guid seatId, CancellationToken cancellationToken)
        => await db.Seats.AsNoTracking().FirstOrDefaultAsync(s => s.Id == seatId, cancellationToken);

    public async Task<Seat?> GetByReservationIdAsync(Guid reservationId, CancellationToken cancellationToken)
        => await db.Seats.AsNoTracking().FirstOrDefaultAsync(s => s.ReservationId == reservationId, cancellationToken);

    public async Task<int> TryReserveAsync(Guid seatId, Guid reservationId, Guid buyerId, DateTime reservedUntilUtc, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;

        return await db.Seats
            .Where(s => s.Id == seatId
                && (s.Status == SeatStatus.Available
                    || (s.Status == SeatStatus.Reserved && s.ReservedUntilUtc != null && s.ReservedUntilUtc < now)))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.Status, SeatStatus.Reserved)
                .SetProperty(s => s.ReservationId, reservationId)
                .SetProperty(s => s.BuyerId, buyerId)
                .SetProperty(s => s.ReservedUntilUtc, reservedUntilUtc)
                .SetProperty(s => s.UpdatedAtUtc, now), cancellationToken);
    }

    public async Task<int> TryConfirmAsync(Guid seatId, Guid reservationId, CancellationToken cancellationToken)
        => await db.Seats
            .Where(s => s.Id == seatId && s.ReservationId == reservationId && s.Status == SeatStatus.Reserved)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.Status, SeatStatus.Sold)
                .SetProperty(s => s.UpdatedAtUtc, DateTime.UtcNow), cancellationToken);

    public async Task<int> TryReleaseAsync(Guid seatId, Guid reservationId, CancellationToken cancellationToken)
        => await db.Seats
            .Where(s => s.Id == seatId && s.ReservationId == reservationId && s.Status == SeatStatus.Reserved)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.Status, SeatStatus.Available)
                .SetProperty(s => s.ReservationId, (Guid?)null)
                .SetProperty(s => s.BuyerId, (Guid?)null)
                .SetProperty(s => s.ReservedUntilUtc, (DateTime?)null)
                .SetProperty(s => s.UpdatedAtUtc, DateTime.UtcNow), cancellationToken);

    public async Task<int> ReleaseExpiredReservationsAsync(CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;

        return await db.Seats
            .Where(s => s.Status == SeatStatus.Reserved && s.ReservedUntilUtc != null && s.ReservedUntilUtc < now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.Status, SeatStatus.Available)
                .SetProperty(s => s.ReservationId, (Guid?)null)
                .SetProperty(s => s.BuyerId, (Guid?)null)
                .SetProperty(s => s.ReservedUntilUtc, (DateTime?)null)
                .SetProperty(s => s.UpdatedAtUtc, now), cancellationToken);
    }
}
