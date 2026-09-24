using Microsoft.EntityFrameworkCore;
using Orders.Application;

namespace Orders.Infrastructure;

public sealed class OrderReadStore(OrdersDbContext db) : IOrderReadStore
{
    public async Task<OrderDto?> GetByIdAsync(Guid orderId, CancellationToken cancellationToken)
    {
        var saga = await db.OrderSagas.AsNoTracking().FirstOrDefaultAsync(s => s.CorrelationId == orderId, cancellationToken);
        if (saga is null)
        {
            return null;
        }

        return new OrderDto(
            saga.CorrelationId,
            saga.CurrentState,
            saga.EventId,
            saga.SeatId,
            saga.Amount,
            saga.Currency,
            saga.FailureReason,
            saga.CreatedAtUtc,
            saga.UpdatedAtUtc);
    }
}
