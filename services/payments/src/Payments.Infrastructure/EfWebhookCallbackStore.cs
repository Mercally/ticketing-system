using Microsoft.EntityFrameworkCore;
using Payments.Application;

namespace Payments.Infrastructure;

public sealed class EfWebhookCallbackStore(PaymentsDbContext db) : IWebhookCallbackStore
{
    public async Task<bool> TryRecordAsync(Guid orderId, string callbackId, CancellationToken cancellationToken)
    {
        db.WebhookCallbacks.Add(new WebhookCallbackRecord
        {
            OrderId = orderId,
            CallbackId = callbackId,
            ReceivedAtUtc = DateTime.UtcNow,
        });

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            // PK (OrderId, CallbackId) violation — this exact callback was already recorded.
            db.ChangeTracker.Clear();
            return false;
        }
    }
}
