using MassTransit;
using Microsoft.Extensions.Logging;
using Orders.Contracts.V1;
using Ticketing.Application;
using Ticketing.Contracts.V1;

namespace Ticketing.Infrastructure;

/// <summary>
/// Consumes ConfirmSeatV1 (Orders' saga, sent after payment succeeds). Idempotent consumption is
/// covered by MassTransit's EF Core Inbox (ADR-0005/0006) configured on this bus — a redelivered
/// MessageId is a no-op before this class's Consume even runs.
/// </summary>
public sealed class ConfirmSeatConsumer(SeatReservationService seats, ILogger<ConfirmSeatConsumer> logger) : IConsumer<ConfirmSeatV1>
{
    public async Task Consume(ConsumeContext<ConfirmSeatV1> context)
    {
        var msg = context.Message;
        var eventId = await seats.ResolveEventIdAsync(msg.SeatId, context.CancellationToken);

        var confirmed = eventId is not null && await seats.ConfirmAsync(eventId.Value, msg.SeatId, msg.ReservationId, context.CancellationToken);

        if (confirmed)
        {
            await context.Publish(new TicketConfirmedV1(msg.OrderId, msg.ReservationId, msg.SeatId, eventId!.Value, DateTime.UtcNow, msg.CorrelationId));
        }
        else
        {
            logger.LogWarning("ConfirmSeat failed for order {OrderId}, seat {SeatId}, reservation {ReservationId}", msg.OrderId, msg.SeatId, msg.ReservationId);
            await context.Publish(new TicketConfirmationFailedV1(msg.OrderId, msg.ReservationId, msg.SeatId, "SeatNotInExpectedState", msg.CorrelationId));
        }
    }
}

public sealed class ReleaseReservationConsumer(SeatReservationService seats, ILogger<ReleaseReservationConsumer> logger) : IConsumer<ReleaseReservationV1>
{
    public async Task Consume(ConsumeContext<ReleaseReservationV1> context)
    {
        var msg = context.Message;
        var eventId = await seats.ResolveEventIdAsync(msg.SeatId, context.CancellationToken);

        if (eventId is null)
        {
            logger.LogWarning("ReleaseReservation: seat {SeatId} not found", msg.SeatId);
        }
        else
        {
            var released = await seats.ReleaseAsync(eventId.Value, msg.SeatId, msg.ReservationId, context.CancellationToken);
            if (!released)
            {
                // Not RESERVED-by-this-reservation-id anymore (already released, expired-and-reclaimed,
                // or confirmed) — idempotent-safe to still acknowledge as released, since the caller's
                // actual concern (this reservation no longer holds the seat) is satisfied either way.
                logger.LogInformation("ReleaseReservation no-op for order {OrderId}, seat {SeatId} — already not held by reservation {ReservationId}", msg.OrderId, msg.SeatId, msg.ReservationId);
            }
        }

        await context.Publish(new ReservationReleasedV1(msg.OrderId, msg.ReservationId, msg.SeatId, msg.CorrelationId));
    }
}
