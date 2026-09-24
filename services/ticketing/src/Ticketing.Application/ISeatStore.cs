using Ticketing.Domain;

namespace Ticketing.Application;

/// <summary>
/// Every mutating method here compiles to exactly one atomic conditional SQL UPDATE (ADR-0002) —
/// the return value is the affected-row count (0 or 1), and that count IS the entire concurrency
/// decision. No method here reads-then-writes.
/// </summary>
public interface ISeatStore
{
    Task<IReadOnlyList<Seat>> ListByEventAsync(Guid eventId, CancellationToken cancellationToken);

    Task<Seat?> GetAsync(Guid seatId, CancellationToken cancellationToken);

    Task<Seat?> GetByReservationIdAsync(Guid reservationId, CancellationToken cancellationToken);

    /// <summary>AVAILABLE (or expired RESERVED) -&gt; RESERVED. Returns 1 if this call won the race, 0 otherwise.</summary>
    Task<int> TryReserveAsync(Guid seatId, Guid reservationId, Guid buyerId, DateTime reservedUntilUtc, CancellationToken cancellationToken);

    /// <summary>RESERVED -&gt; SOLD, only for the matching reservationId. Returns 1 if it won, 0 otherwise.</summary>
    Task<int> TryConfirmAsync(Guid seatId, Guid reservationId, CancellationToken cancellationToken);

    /// <summary>RESERVED -&gt; AVAILABLE, only for the matching reservationId. Returns 1 if it won, 0 otherwise.</summary>
    Task<int> TryReleaseAsync(Guid seatId, Guid reservationId, CancellationToken cancellationToken);

    /// <summary>Hygiene sweep only (ADR-0002) — correctness never depends on this running.</summary>
    Task<int> ReleaseExpiredReservationsAsync(CancellationToken cancellationToken);
}
