namespace Payments.Application;

/// <summary>Shape matches docs/CONTRACTS.md §7's GET /{orderId} response exactly.</summary>
public sealed record PaymentStatusDto(Guid OrderId, string Status, Guid? PaymentId, string? FailureReason);

public sealed class PaymentsQueryService(IPaymentStore payments)
{
    public async Task<PaymentStatusDto?> GetByOrderIdAsync(Guid orderId, CancellationToken cancellationToken)
    {
        var payment = await payments.GetByOrderIdAsync(orderId, cancellationToken);
        return payment is null
            ? null
            : new PaymentStatusDto(payment.OrderId, payment.Status.ToString(), payment.Id, payment.FailureReason);
    }
}
