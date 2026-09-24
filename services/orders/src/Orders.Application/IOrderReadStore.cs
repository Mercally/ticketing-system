namespace Orders.Application;

/// <summary>
/// Reads the saga instance directly as the order's queryable state (see
/// Orders.Infrastructure.Saga.OrderSagaState) — there is deliberately no separate "Order" table
/// kept in sync with the saga; the saga instance IS the order aggregate for this workflow.
/// </summary>
public interface IOrderReadStore
{
    Task<OrderDto?> GetByIdAsync(Guid orderId, CancellationToken cancellationToken);
}
