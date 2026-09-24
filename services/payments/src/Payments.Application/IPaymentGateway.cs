namespace Payments.Application;

/// <summary>
/// The abstraction the prompt asks for by name ("Crear una abstracción: IPaymentGateway"), living
/// in Application (not Infrastructure) per that same requirement. The real implementation
/// (Payments.Infrastructure.HttpPaymentGatewayClient) calls the Fake Payment Gateway over HTTP —
/// a separate process, not an in-process fake (DECISIONS.md D2), so this interface's contract is
/// written as if a real payment processor were on the other end: it can fail, it can be slow, it
/// must never be called indiscriminately more than once for the same intent.
/// </summary>
public interface IPaymentGateway
{
    Task<PaymentGatewayResult> AuthorizeAsync(PaymentGatewayRequest request, CancellationToken cancellationToken);

    Task RefundAsync(string authCode, Guid orderId, CancellationToken cancellationToken);
}

public sealed record PaymentGatewayRequest(Guid OrderId, decimal Amount, string Currency, string? SimulationMode);

public sealed record PaymentGatewayResult(bool Approved, string? AuthCode, string? DeclineReason);
