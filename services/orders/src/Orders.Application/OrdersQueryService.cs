namespace Orders.Application;

public sealed class OrdersQueryService(IOrderReadStore readStore)
{
    public Task<OrderDto?> GetByIdAsync(Guid orderId, CancellationToken cancellationToken)
        => readStore.GetByIdAsync(orderId, cancellationToken);
}
