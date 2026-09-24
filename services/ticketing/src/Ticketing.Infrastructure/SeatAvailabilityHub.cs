using Microsoft.AspNetCore.SignalR;
using Ticketing.Application;
using Ticketing.Domain;

namespace Ticketing.Infrastructure;

/// <summary>Mounted at /hubs/seat-availability (ADR-0007). Best-effort broadcast only — never authoritative.</summary>
public sealed class SeatAvailabilityHub : Hub
{
    public Task JoinEvent(Guid eventId) => Groups.AddToGroupAsync(Context.ConnectionId, GroupName(eventId));

    public static string GroupName(Guid eventId) => $"event:{eventId}";
}

public sealed class SignalRSeatAvailabilityNotifier(IHubContext<SeatAvailabilityHub> hub) : ISeatAvailabilityNotifier
{
    public Task SeatStatusChangedAsync(Guid eventId, Guid seatId, SeatStatus status, CancellationToken cancellationToken)
        => hub.Clients.Group(SeatAvailabilityHub.GroupName(eventId))
            .SendAsync("SeatStatusChanged", new { seatId, status }, cancellationToken);
}
