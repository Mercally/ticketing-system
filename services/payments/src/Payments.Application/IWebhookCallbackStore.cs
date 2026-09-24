namespace Payments.Application;

/// <summary>
/// Backs POST /webhook's idempotency (docs/CONTRACTS.md §7). Deliberately NOT
/// building-blocks/idempotency's [Idempotent] filter — that mechanism is for a CLIENT retrying an
/// HTTP POST under a client-supplied Idempotency-Key header (ADR-0006 layer 1). This is a
/// system-to-system webhook from the Fake Payment Gateway, deduped by a (orderId, callbackId) pair
/// IT supplies in the body — a different mechanism for a different hop, exercised by
/// DuplicateCallback simulation mode firing the same callbackId twice.
/// </summary>
public interface IWebhookCallbackStore
{
    /// <summary>True if (orderId, callbackId) had never been seen before (and is now recorded);
    /// false if it's a duplicate, which callers must treat as a safe no-op.</summary>
    Task<bool> TryRecordAsync(Guid orderId, string callbackId, CancellationToken cancellationToken);
}
