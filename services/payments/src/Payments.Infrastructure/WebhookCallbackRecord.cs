namespace Payments.Infrastructure;

/// <summary>
/// Dedup record for POST /webhook (docs/CONTRACTS.md §7/§8) — see
/// Payments.Application.IWebhookCallbackStore for why this is a distinct mechanism from
/// building-blocks/idempotency's [Idempotent] filter. Pure persistence shape, no domain behavior,
/// so it lives here rather than in Payments.Domain (mirrors IdempotencyKeyRecord's placement).
/// </summary>
public sealed class WebhookCallbackRecord
{
    public Guid OrderId { get; set; }
    public string CallbackId { get; set; } = default!;
    public DateTime ReceivedAtUtc { get; set; }
}
