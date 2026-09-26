using Microsoft.Extensions.Options;
using Ticketing.Domain;

namespace Ticketing.Application;

public sealed class SeatReservationService(ISeatStore seats, ISeatAvailabilityNotifier notifier, IOptions<TicketingOptions> options)
{
    public async Task<IReadOnlyList<SeatDto>> ListSeatsAsync(Guid eventId, CancellationToken cancellationToken)
    {
        var seatEntities = await seats.ListByEventAsync(eventId, cancellationToken);
        return seatEntities
            .OrderBy(s => s.Row).ThenBy(s => s.Label)
            .Select(s => new SeatDto(s.Id, s.Label, s.Section, s.Row, s.Status))
            .ToList();
    }

    public async Task<ReserveSeatResult> ReserveAsync(ReserveSeatRequest request, CancellationToken cancellationToken)
    {
        var reservationId = Guid.NewGuid();
        var expiresAtUtc = DateTime.UtcNow.Add(options.Value.ReservationTtl);

        var affected = await seats.TryReserveAsync(request.SeatId, reservationId, request.BuyerId, expiresAtUtc, cancellationToken);

        if (affected == 0)
        {
            return new ReserveSeatResult(false, null, null);
        }

        await notifier.SeatStatusChangedAsync(request.EventId, request.SeatId, SeatStatus.Reserved, cancellationToken);
        return new ReserveSeatResult(true, reservationId, expiresAtUtc);
    }

    /// <summary>Buyer-initiated release (POST /reservations/{id}/release) — the route only carries the
    /// reservation id, so the seat/event are resolved from it first. <paramref name="callerBuyerId"/> is
    /// the authenticated caller's own id (from the JWT "sub" claim, not client-supplied) — only the buyer
    /// who holds the reservation may release it.</summary>
    public async Task<ReservationReleaseOutcome> ReleaseByReservationAsync(Guid reservationId, Guid callerBuyerId, CancellationToken cancellationToken)
    {
        var seat = await seats.GetByReservationIdAsync(reservationId, cancellationToken);
        if (seat is null)
        {
            return ReservationReleaseOutcome.NotFound;
        }

        if (seat.BuyerId != callerBuyerId)
        {
            return ReservationReleaseOutcome.Forbidden;
        }

        var affected = await seats.TryReleaseAsync(seat.Id, reservationId, cancellationToken);
        if (affected == 1)
        {
            await notifier.SeatStatusChangedAsync(seat.EventId, seat.Id, SeatStatus.Available, cancellationToken);
        }

        return affected == 1 ? ReservationReleaseOutcome.Released : ReservationReleaseOutcome.NotFound;
    }

    public async Task<bool> ConfirmAsync(Guid eventId, Guid seatId, Guid reservationId, CancellationToken cancellationToken)
    {
        var affected = await seats.TryConfirmAsync(seatId, reservationId, cancellationToken);
        if (affected == 1)
        {
            await notifier.SeatStatusChangedAsync(eventId, seatId, SeatStatus.Sold, cancellationToken);
        }

        return affected == 1;
    }

    /// <summary>Used by MassTransit consumers, which only receive SeatId on the wire (docs/CONTRACTS.md §10) but need EventId to route the SignalR broadcast.</summary>
    public async Task<Guid?> ResolveEventIdAsync(Guid seatId, CancellationToken cancellationToken)
    {
        var seat = await seats.GetAsync(seatId, cancellationToken);
        return seat?.EventId;
    }

    public async Task<bool> ReleaseAsync(Guid eventId, Guid seatId, Guid reservationId, CancellationToken cancellationToken)
    {
        var affected = await seats.TryReleaseAsync(seatId, reservationId, cancellationToken);
        if (affected == 1)
        {
            await notifier.SeatStatusChangedAsync(eventId, seatId, SeatStatus.Available, cancellationToken);
        }

        return affected == 1;
    }
}
