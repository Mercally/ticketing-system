namespace Payments.Domain;

/// <summary>
/// A payment attempt for exactly one order. <see cref="OrderId"/> carries a UNIQUE constraint at
/// the persistence layer (Payments.Infrastructure.PaymentsDbContext) — the last line of defense
/// (ADR-0006, docs/CONTRACTS.md §7) that makes "a payment is 1:1 with an order by construction"
/// actually true, on top of the application-level idempotent-by-OrderId check in
/// Payments.Application.PaymentProcessingService. Never stores card data (prompt requirement) —
/// only the gateway's AuthCode, which is an opaque authorization token, not payment instrument data.
/// </summary>
public sealed class Payment
{
    public Guid Id { get; private set; }
    public Guid OrderId { get; private set; }
    public decimal Amount { get; private set; }
    public string Currency { get; private set; } = default!;
    public PaymentStatus Status { get; private set; }
    public string? AuthCode { get; private set; }
    public string? FailureReason { get; private set; }
    public DateTime? ProcessedAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    private Payment() { }

    private Payment(Guid id, Guid orderId, decimal amount, string currency)
    {
        Id = id;
        OrderId = orderId;
        Amount = amount;
        Currency = currency;
        Status = PaymentStatus.Pending;
        CreatedAtUtc = DateTime.UtcNow;
    }

    public static Payment CreatePending(Guid orderId, decimal amount, string currency)
        => new(Guid.NewGuid(), orderId, amount, currency);

    public void MarkSucceeded(string authCode, DateTime processedAtUtc)
    {
        Status = PaymentStatus.Succeeded;
        AuthCode = authCode;
        FailureReason = null;
        ProcessedAtUtc = processedAtUtc;
    }

    public void MarkFailed(string reason, DateTime processedAtUtc)
    {
        Status = PaymentStatus.Failed;
        FailureReason = reason;
        ProcessedAtUtc = processedAtUtc;
    }

    /// <summary>Only valid from Succeeded — enforced by the caller (PaymentProcessingService),
    /// not here, so a bad call surfaces as a clear application-level guard rather than a silent
    /// domain no-op.</summary>
    public void MarkRefunded()
    {
        Status = PaymentStatus.Refunded;
    }
}
