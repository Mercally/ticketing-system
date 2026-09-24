/**
 * MassTransit's standard JSON message envelope, as produced by the .NET
 * publishers (Order/Payment/Ticketing services). Every message MassTransit
 * puts on the wire is wrapped in this shape — the actual event payload lives
 * under `message`, with PascalCase field names exactly matching the C#
 * record properties (MassTransit's default JSON serializer uses the C#
 * property names as-is; see CONTRACTS.md §10).
 *
 * We subscribe our SQS queue to each SNS topic with `RawMessageDelivery:
 * true` (see topic-arn.util.ts / queue-provisioning.service.ts), so the raw
 * SQS message `Body` IS this envelope's JSON directly — there is no
 * additional outer SNS `{ Type, MessageId, Message, ... }` wrapper to strip
 * first. If a topic is ever (re)subscribed without RawMessageDelivery, the
 * SQS body would instead be an SNS notification envelope with this JSON
 * string nested under its own `Message` field — deliberately NOT handled
 * here since our own Subscribe calls always request raw delivery.
 */
export interface MassTransitEnvelope<TMessage> {
  /** Unique id for this exact message delivery attempt/publish — our inbox dedupe key. */
  messageId: string;
  requestId?: string | null;
  /**
   * MassTransit's own transport-level correlation id. We deliberately do
   * NOT use this field for business correlation (DECISIONS.md D9) — the
   * business CorrelationId lives inside `message` on every one of our four
   * consumed payload shapes, and that's the one we thread through logs and
   * the outbound publish.
   */
  correlationId?: string | null;
  conversationId?: string | null;
  sourceAddress?: string | null;
  destinationAddress?: string | null;
  responseAddress?: string | null;
  /**
   * Array of URN-style type names identifying the message, e.g.
   * `urn:message:Orders.Contracts.V1:OrderConfirmedV1`. We classify the
   * event by scanning this array for the known type-name suffixes rather
   * than depending on the exact URN formatting (see
   * `classifyEventType` in event-classifier.ts).
   */
  messageType: string[];
  message: TMessage;
  sentTime?: string | null;
  headers?: Record<string, unknown>;
  host?: unknown;
}
