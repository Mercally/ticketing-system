using Microsoft.EntityFrameworkCore;
using Payments.Application;
using Payments.Domain;

namespace Payments.Infrastructure;

public sealed class EfPaymentStore(PaymentsDbContext db) : IPaymentStore
{
    // Intentionally tracked (no AsNoTracking): the refund flow reads a Payment here, mutates it via
    // its domain methods, and hands the same instance back to UpdateAsync — this only works cleanly
    // against a tracked entity from the same DbContext (a scoped, per-message-consumption instance).
    public async Task<Payment?> GetByOrderIdAsync(Guid orderId, CancellationToken cancellationToken)
        => await db.Payments.FirstOrDefaultAsync(p => p.OrderId == orderId, cancellationToken);

    public async Task<bool> TryAddAsync(Payment payment, CancellationToken cancellationToken)
    {
        db.Payments.Add(payment);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            // UNIQUE(order_id) violation (ADR-0006 last line of defense) — a concurrent attempt for
            // this order already landed first.
            db.ChangeTracker.Clear();
            return false;
        }
    }

    public async Task UpdateAsync(Payment payment, CancellationToken cancellationToken)
    {
        db.Payments.Update(payment);
        await db.SaveChangesAsync(cancellationToken);
    }
}
