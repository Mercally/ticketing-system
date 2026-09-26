using Ticketing.Domain;

namespace Ticketing.Application;

public sealed record SeatDto(Guid Id, string Label, string Section, int Row, SeatStatus Status);

public sealed record ReserveSeatRequest(Guid EventId, Guid SeatId, Guid BuyerId);

public sealed record ReserveSeatResult(bool Success, Guid? ReservationId, DateTime? ExpiresAtUtc);

/// <summary>NotFound and Forbidden are distinguished so the controller can return 404 vs 403 —
/// only the buyer who holds a reservation may release it (see SeatReservationService.ReleaseByReservationAsync).</summary>
public enum ReservationReleaseOutcome
{
    NotFound,
    Forbidden,
    Released,
}
