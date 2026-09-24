import { SUPPORTED_EVENT_TYPES, type SupportedEventType } from '../dto/consumed-events.js';

/**
 * Classifies a MassTransit envelope's `messageType` array into one of our
 * four supported event types by matching the well-known type-name suffix
 * (e.g. "OrderConfirmedV1") rather than depending on the exact URN
 * formatting MassTransit produces (`urn:message:Namespace:TypeName`, which
 * can vary by MassTransit version/configuration). Returns `null` when none
 * of the known types match — callers treat that as an unsupported message
 * and leave it for SQS redelivery/DLQ rather than silently dropping it.
 */
export function classifyEventType(messageType: readonly string[] | undefined): SupportedEventType | null {
  if (!messageType || messageType.length === 0) {
    return null;
  }
  for (const candidate of SUPPORTED_EVENT_TYPES) {
    if (messageType.some((entry) => entry.includes(candidate))) {
      return candidate;
    }
  }
  return null;
}
