using Payments.Domain;

namespace Payments.Application;

public interface IPaymentStore
{
    Task<Payment?> GetByOrderIdAsync(Guid orderId, CancellationToken cancellationToken);

    /// <summary>
    /// Inserts a new payment row. Returns false if a concurrent attempt for the same OrderId already
    /// landed first — the UNIQUE(order_id) constraint (ADR-0006's "last line of defense") catching a
    /// genuine race that the application-level idempotency check in PaymentProcessingService didn't
    /// (e.g. two deliveries processed concurrently before either committed).
    /// </summary>
    Task<bool> TryAddAsync(Payment payment, CancellationToken cancellationToken);

    Task UpdateAsync(Payment payment, CancellationToken cancellationToken);
}
