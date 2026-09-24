using MassTransit;
using Orders.Contracts.V1;
using Payments.Contracts.V1;
using Ticketing.Contracts.V1;

namespace Orders.Infrastructure.Saga;

/// <summary>
/// Orchestrates Create Order -> Process Payment -> Confirm Seat/Ticket, with compensation on
/// failure (ARCHITECTURE.md §7, ADR-0003). All outgoing "commands" are Publish, not Send — see
/// DECISIONS.md D3 amendment on Orders.Contracts.V1's file header: this avoids needing to know
/// another independently-compiled service's exact queue address.
///
/// State names match docs/CONTRACTS.md §6's order status values exactly, so
/// OrderSagaState.CurrentState can be returned by the API with zero translation.
///
/// Deliberately never calls Finalize()/SetCompletedWhenFinalized() — the saga instance is the
/// order's permanent read model (Orders.Application.IOrderReadStore), so GET /orders/{id} must
/// still find the row long after it reaches Completed/Cancelled.
/// </summary>
public sealed class OrderStateMachine : MassTransitStateMachine<OrderSagaState>
{
    public State AwaitingPayment { get; private set; } = default!;
    public State Confirming { get; private set; } = default!;
    public State Cancelling { get; private set; } = default!;
    public State Completed { get; private set; } = default!;
    public State Cancelled { get; private set; } = default!;

    public Event<OrderSubmittedV1> OrderSubmitted { get; private set; } = default!;
    public Event<PaymentSucceededV1> PaymentSucceeded { get; private set; } = default!;
    public Event<PaymentFailedV1> PaymentFailed { get; private set; } = default!;
    public Event<TicketConfirmedV1> TicketConfirmed { get; private set; } = default!;
    public Event<TicketConfirmationFailedV1> TicketConfirmationFailed { get; private set; } = default!;
    public Event<ReservationReleasedV1> ReservationReleased { get; private set; } = default!;

    public OrderStateMachine()
    {
        InstanceState(x => x.CurrentState);

        Event(() => OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => PaymentSucceeded, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => PaymentFailed, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => TicketConfirmed, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => TicketConfirmationFailed, x => x.CorrelateById(m => m.Message.OrderId));
        Event(() => ReservationReleased, x => x.CorrelateById(m => m.Message.OrderId));

        Initially(
            When(OrderSubmitted)
                .Then(context =>
                {
                    var now = DateTime.UtcNow;
                    context.Saga.ReservationId = context.Message.ReservationId;
                    context.Saga.SeatId = context.Message.SeatId;
                    context.Saga.EventId = context.Message.EventId;
                    context.Saga.BuyerId = context.Message.BuyerId;
                    context.Saga.Amount = context.Message.Amount;
                    context.Saga.Currency = context.Message.Currency;
                    context.Saga.PaymentSimulationMode = context.Message.PaymentSimulationMode;
                    context.Saga.CreatedAtUtc = now;
                    context.Saga.UpdatedAtUtc = now;
                })
                // IdempotencyKey = OrderId, deterministic — Payment Service's UNIQUE(order_id)
                // constraint is the last line of defense either way (ADR-0006).
                .Publish(context => new ProcessPaymentV1(
                    context.Saga.CorrelationId,
                    context.Saga.BuyerId,
                    context.Saga.Amount,
                    context.Saga.Currency,
                    context.Saga.CorrelationId.ToString(),
                    context.Saga.PaymentSimulationMode,
                    context.Saga.CorrelationId))
                .TransitionTo(AwaitingPayment));

        During(AwaitingPayment,
            When(PaymentSucceeded)
                .Then(context => context.Saga.UpdatedAtUtc = DateTime.UtcNow)
                .Publish(context => new ConfirmSeatV1(context.Saga.CorrelationId, context.Saga.ReservationId, context.Saga.SeatId, context.Saga.CorrelationId))
                .TransitionTo(Confirming),
            When(PaymentFailed)
                .Then(context =>
                {
                    context.Saga.FailureReason = context.Message.Reason;
                    context.Saga.UpdatedAtUtc = DateTime.UtcNow;
                })
                .Publish(context => new ReleaseReservationV1(context.Saga.CorrelationId, context.Saga.ReservationId, context.Saga.SeatId, context.Saga.CorrelationId))
                .TransitionTo(Cancelling));

        During(Confirming,
            When(TicketConfirmed)
                .Then(context => context.Saga.UpdatedAtUtc = DateTime.UtcNow)
                .Publish(context => new OrderConfirmedV1(
                    context.Saga.CorrelationId,
                    context.Saga.EventId,
                    context.Saga.SeatId,
                    context.Saga.BuyerId,
                    context.Saga.Amount,
                    DateTime.UtcNow,
                    context.Saga.CorrelationId))
                .TransitionTo(Completed),
            // DECISIONS.md D8: payment succeeded but seat confirmation then failed (e.g. TTL
            // lapsed mid-flight) — release the reservation AND refund, so a buyer is never
            // charged for a seat they don't get. Not in the prompt's literal compensation path;
            // added for correctness.
            When(TicketConfirmationFailed)
                .Then(context =>
                {
                    context.Saga.FailureReason = context.Message.Reason;
                    context.Saga.UpdatedAtUtc = DateTime.UtcNow;
                })
                .Publish(context => new ReleaseReservationV1(context.Saga.CorrelationId, context.Saga.ReservationId, context.Saga.SeatId, context.Saga.CorrelationId))
                .Publish(context => new RefundPaymentV1(context.Saga.CorrelationId, "TicketConfirmationFailed: " + context.Message.Reason, context.Saga.CorrelationId))
                .TransitionTo(Cancelling));

        During(Cancelling,
            When(ReservationReleased)
                .Then(context => context.Saga.UpdatedAtUtc = DateTime.UtcNow)
                .Publish(context => new OrderCancelledV1(context.Saga.CorrelationId, context.Saga.FailureReason ?? "Unknown", context.Saga.CorrelationId))
                .TransitionTo(Cancelled));
    }
}
