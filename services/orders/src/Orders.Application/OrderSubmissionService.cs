using Orders.Contracts.V1;
using TicketingPlatform.Observability;

namespace Orders.Application;

/// <summary>
/// Kicks off the saga (D7: reservation is a precondition, the saga itself starts at
/// "Create Order"). Publishing OrderSubmittedV1 here, and the saga's Initially(When(...)) handler
/// persisting the first saga-instance row on consumption, means there is a brief window where
/// GET /orders/{id} can 404 right after this returns — accepted eventual consistency (ADR-0003),
/// the frontend polls.
/// </summary>
public sealed class OrderSubmissionService(IOrderEventPublisher publisher)
{
    public async Task<CreateOrderResult> SubmitAsync(CreateOrderRequest request, CancellationToken cancellationToken)
    {
        var orderId = Guid.NewGuid();

        // DECISIONS.md D9: CorrelationId becomes the OrderId once an order exists, superseding
        // whatever pre-order correlation id the client was carrying — update the ambient context
        // so the rest of THIS request (idempotency response logging, etc) also uses it.
        CorrelationContext.CorrelationId = orderId.ToString();

        await publisher.PublishOrderSubmittedAsync(
            new OrderSubmittedV1(
                orderId,
                request.ReservationId,
                request.SeatId,
                request.EventId,
                request.BuyerId,
                request.Amount,
                request.Currency,
                request.PaymentSimulationMode,
                orderId),
            cancellationToken);

        return new CreateOrderResult(orderId, "Submitted");
    }
}
