using Microsoft.Extensions.Logging;

namespace Payments.Application;

/// <summary>Backs POST /webhook (Payments.Api.Controllers.WebhookController). See
/// IWebhookCallbackStore for why this is a distinct idempotency mechanism from [Idempotent].</summary>
public sealed class PaymentWebhookService(IWebhookCallbackStore callbacks, ILogger<PaymentWebhookService> logger)
{
    public async Task HandleCallbackAsync(Guid orderId, string callbackId, bool approved, string? authCode, CancellationToken cancellationToken)
    {
        var isNew = await callbacks.TryRecordAsync(orderId, callbackId, cancellationToken);
        if (!isNew)
        {
            // DuplicateCallback simulation mode fires this webhook twice with the same callbackId
            // (docs/CONTRACTS.md §8) — safe no-op, exactly as required: log it, don't reprocess.
            logger.LogInformation(
                "Webhook callback {CallbackId} for order {OrderId} already processed — ignoring duplicate",
                callbackId, orderId);
            return;
        }

        // The synchronous /authorize response (already handled by ProcessPaymentConsumer well
        // before this webhook can arrive) is the authoritative outcome for this PoC's fake gateway.
        // This webhook mirrors what some real gateways send as a secondary async confirmation —
        // there's nothing to reconcile against the Payment row here; recording+logging receipt is
        // the whole job.
        logger.LogInformation(
            "Webhook callback {CallbackId} received for order {OrderId} (approved={Approved}, authCode={AuthCode})",
            callbackId, orderId, approved, authCode);
    }
}
