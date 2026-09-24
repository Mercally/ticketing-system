import type { MassTransitEnvelope } from '../dto/masstransit-envelope.js';
import { MalformedMessageError } from '../errors.js';

/**
 * Parses a raw SQS message body into a MassTransit envelope. Because our
 * SNS subscriptions request `RawMessageDelivery: true`, the SQS body is the
 * envelope JSON directly — no outer SNS notification wrapper to strip.
 */
export function parseEnvelope(rawBody: string): MassTransitEnvelope<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new MalformedMessageError('body is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new MalformedMessageError('body did not parse to a JSON object');
  }

  const envelope = parsed as Partial<MassTransitEnvelope<unknown>>;
  if (typeof envelope.messageId !== 'string' || !envelope.messageId) {
    throw new MalformedMessageError('missing messageId');
  }
  if (!Array.isArray(envelope.messageType)) {
    throw new MalformedMessageError('missing messageType array');
  }
  if (typeof envelope.message !== 'object' || envelope.message === null) {
    throw new MalformedMessageError('missing message payload');
  }

  return envelope as MassTransitEnvelope<unknown>;
}
