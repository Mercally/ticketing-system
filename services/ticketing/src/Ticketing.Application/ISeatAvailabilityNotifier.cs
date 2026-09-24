using Ticketing.Domain;

namespace Ticketing.Application;

/// <summary>
/// Best-effort SignalR broadcast (ADR-0007) — implemented in Infrastructure via a SignalR hub
/// context. Never the authority for anything; purely a live-UI nicety.
/// </summary>
public interface ISeatAvailabilityNotifier
{
    Task SeatStatusChangedAsync(Guid eventId, Guid seatId, SeatStatus status, CancellationToken cancellationToken);
}
