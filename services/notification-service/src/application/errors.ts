/**
 * Thrown when an SQS message body isn't valid JSON, or doesn't look like a
 * MassTransit envelope (missing `messageId`/`message`/`messageType`). Left
 * un-acked by the caller so SQS's own redrive policy routes it to the DLQ
 * after the configured max-receive-count — this service must never silently
 * drop a message it can't understand.
 */
export class MalformedMessageError extends Error {
  constructor(reason: string) {
    super(`Malformed inbound message: ${reason}`);
    this.name = 'MalformedMessageError';
  }
}

/**
 * Thrown when a well-formed MassTransit envelope's `messageType` doesn't
 * match any of the four event types this service knows how to handle.
 * Also left un-acked — same poison-message handling as above.
 */
export class UnsupportedMessageTypeError extends Error {
  constructor(messageType: readonly string[]) {
    super(`Unsupported message type(s): ${messageType.join(', ') || '(none)'}`);
    this.name = 'UnsupportedMessageTypeError';
  }
}
