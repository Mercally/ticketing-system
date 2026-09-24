using System.Net;
using System.Net.Http.Json;
using Payments.Application;

namespace Payments.Infrastructure;

/// <summary>
/// Real implementation of IPaymentGateway (Payments.Application) — calls the Fake Payment Gateway
/// process over real HTTP (DECISIONS.md D2: a separate process, not an in-process fake, so a genuine
/// network hop exists for the resilience pipeline to actually exercise). The named HttpClient this
/// depends on ("FakePaymentGateway") is registered in Payments.Api/Program.cs with a Polly pipeline
/// in the order timeout -> retry -> circuit breaker (docs/CONTRACTS.md §7) — see that file for the
/// exact numbers and the reasoning behind the retry predicate.
/// </summary>
public sealed class HttpPaymentGatewayClient(HttpClient httpClient) : IPaymentGateway
{
    public const string HttpClientName = "FakePaymentGateway";

    public async Task<PaymentGatewayResult> AuthorizeAsync(PaymentGatewayRequest request, CancellationToken cancellationToken)
    {
        var response = await httpClient.PostAsJsonAsync(
            "/authorize",
            new
            {
                orderId = request.OrderId,
                amount = request.Amount,
                currency = request.Currency,
                simulationMode = request.SimulationMode,
            },
            cancellationToken);

        if (response.StatusCode == HttpStatusCode.OK)
        {
            var body = await response.Content.ReadFromJsonAsync<AuthorizeApprovedResponse>(cancellationToken)
                ?? throw new InvalidOperationException("Empty /authorize approved response body.");
            return new PaymentGatewayResult(true, body.AuthCode, null);
        }

        if (response.StatusCode == HttpStatusCode.PaymentRequired)
        {
            var body = await response.Content.ReadFromJsonAsync<AuthorizeDeclinedResponse>(cancellationToken);
            return new PaymentGatewayResult(false, null, body?.Reason ?? "Declined");
        }

        // Any other status is unexpected for this fake gateway's contract — surface it as a failure
        // (caught by PaymentProcessingService) rather than trying to interpret an unknown shape.
        response.EnsureSuccessStatusCode();
        throw new InvalidOperationException("Unreachable — EnsureSuccessStatusCode always throws for non-2xx.");
    }

    public async Task RefundAsync(string authCode, Guid orderId, CancellationToken cancellationToken)
    {
        var response = await httpClient.PostAsJsonAsync("/refund", new { orderId, authCode }, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private sealed record AuthorizeApprovedResponse(bool Approved, string? AuthCode);

    private sealed record AuthorizeDeclinedResponse(bool Approved, string? Reason);
}
