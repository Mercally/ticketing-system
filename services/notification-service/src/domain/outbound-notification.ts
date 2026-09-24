/**
 * The one domain concept this service owns: an outbound notification.
 *
 * It is deliberately minimal — Notification Service has no aggregates, no
 * business rules beyond "translate a consumed domain event into a short
 * human-readable notice and forward the business CorrelationId." See
 * ADR-0009: this service is a pure event consumer/republisher, not a
 * transactional participant in the purchase flow.
 *
 * Shape matches CONTRACTS.md §9 exactly: the outbound SNS payload published
 * to `notifications-outbound`.
 */
export interface OutboundNotification {
  /** Short machine/human string, e.g. "order.confirmed", "payment.failed". */
  readonly type: string;
  /** Business correlation id, propagated from the inbound event payload (DECISIONS.md D9) — never the OTel trace id. */
  readonly correlationId: string;
  readonly orderId: string;
  /** Short human-readable summary, e.g. "Your order has been confirmed". */
  readonly message: string;
  readonly occurredAtUtc: string;
}

/**
 * Constructs an OutboundNotification, enforcing the one invariant that
 * matters here: none of the fields required to reconstruct "what happened,
 * for which order, for which purchase" may be empty.
 */
export function createOutboundNotification(fields: OutboundNotification): OutboundNotification {
  const required: Array<keyof OutboundNotification> = ['type', 'correlationId', 'orderId', 'message', 'occurredAtUtc'];
  for (const field of required) {
    if (!fields[field]) {
      throw new Error(`OutboundNotification.${field} must not be empty`);
    }
  }
  return Object.freeze({ ...fields });
}
