using Microsoft.AspNetCore.Mvc;
using Payments.Application;

namespace Payments.Api.Controllers;

// Called directly by the Fake Payment Gateway process, NOT proxied through the Gateway
// (docs/CONTRACTS.md §7: "internal, called by Fake Payment Gateway, not via gateway proxy").
[ApiController]
[Route("webhook")]
public sealed class WebhookController(PaymentWebhookService webhooks) : ControllerBase
{
    public sealed record WebhookCallbackRequest(Guid OrderId, string CallbackId, bool Approved, string? AuthCode);

    // Idempotent by (orderId, callbackId) via PaymentWebhookService/IWebhookCallbackStore — NOT the
    // [Idempotent] attribute (that's for client-retried POSTs carrying an Idempotency-Key header;
    // this is a system-to-system webhook deduped by a callback id the caller supplies in the body).
    [HttpPost]
    public async Task<IActionResult> Handle([FromBody] WebhookCallbackRequest request, CancellationToken cancellationToken)
    {
        await webhooks.HandleCallbackAsync(request.OrderId, request.CallbackId, request.Approved, request.AuthCode, cancellationToken);
        return NoContent();
    }
}
