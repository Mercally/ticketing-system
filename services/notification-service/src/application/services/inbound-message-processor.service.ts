import { Injectable } from '@nestjs/common';
import { InboxService } from './inbox.service.js';
import { classifyEventType } from './event-classifier.js';
import { parseEnvelope } from './parse-envelope.js';
import { UnsupportedMessageTypeError } from '../errors.js';
import { HandleOrderConfirmedUseCase } from '../use-cases/handle-order-confirmed.use-case.js';
import { HandlePaymentSucceededUseCase } from '../use-cases/handle-payment-succeeded.use-case.js';
import { HandlePaymentFailedUseCase } from '../use-cases/handle-payment-failed.use-case.js';
import { HandleTicketConfirmedUseCase } from '../use-cases/handle-ticket-confirmed.use-case.js';
import { SnsOutboundPublisherService } from '../../infrastructure/messaging/sns-outbound-publisher.service.js';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service.js';
import type {
  OrderConfirmedV1,
  PaymentFailedV1,
  PaymentSucceededV1,
  SupportedEventType,
  TicketConfirmedV1,
} from '../dto/consumed-events.js';
import type { OutboundNotification } from '../../domain/outbound-notification.js';

export type ProcessOutcome = 'processed' | 'duplicate-skipped';

/**
 * The core message-processing pipeline, deliberately separated from the
 * SQS polling mechanics (SqsConsumerService) so it can be unit-tested
 * directly against a raw message body with mocked Prisma/SNS — no live
 * queue, no poll loop, no timers involved.
 *
 * Sequence (see requirements: idempotent Inbox + outbound publish):
 *   1. Parse the MassTransit envelope (SQS body is the envelope JSON
 *      directly — our SNS subscriptions use RawMessageDelivery: true).
 *   2. Check the inbox BEFORE doing any work. Already processed -> skip.
 *   3. Classify the event type and run its use-case to build the outbound
 *      notification (pure — CorrelationId comes from the payload, not a
 *      transport header).
 *   4. Publish the outbound notification (retried internally on transient
 *      SNS errors).
 *   5. ONLY AFTER successful publish, insert the inbox row. If a
 *      concurrent redelivery already inserted it first, the unique
 *      constraint violation is treated as "already processed," not an
 *      error (see InboxService).
 *
 * Any error thrown here (malformed body, unsupported type, DB/AWS errors
 * that aren't a duplicate race) propagates to the caller, which leaves the
 * SQS message un-acked for redelivery/eventual DLQ rather than swallowing it.
 */
@Injectable()
export class InboundMessageProcessor {
  constructor(
    private readonly inbox: InboxService,
    private readonly handleOrderConfirmed: HandleOrderConfirmedUseCase,
    private readonly handlePaymentSucceeded: HandlePaymentSucceededUseCase,
    private readonly handlePaymentFailed: HandlePaymentFailedUseCase,
    private readonly handleTicketConfirmed: HandleTicketConfirmedUseCase,
    private readonly publisher: SnsOutboundPublisherService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async process(rawBody: string): Promise<ProcessOutcome> {
    const envelope = parseEnvelope(rawBody);
    const { messageId, message, messageType } = envelope;

    if (await this.inbox.isAlreadyProcessed(messageId)) {
      this.logger.log('Duplicate delivery skipped (already in inbox)', { messageId });
      return 'duplicate-skipped';
    }

    const eventType = classifyEventType(messageType);
    if (!eventType) {
      throw new UnsupportedMessageTypeError(messageType);
    }

    const outbound = this.buildOutboundNotification(eventType, message);
    this.logger.log(`Processing ${eventType}`, { messageId, correlationId: outbound.correlationId });

    await this.publisher.publish(outbound);

    const insertOutcome = await this.inbox.markProcessed(messageId);
    if (insertOutcome === 'already-processed') {
      this.logger.warn('Inbox insert lost a race after processing completed; message was already recorded', {
        messageId,
        correlationId: outbound.correlationId,
      });
    }

    this.logger.log(`Finished processing ${eventType}`, { messageId, correlationId: outbound.correlationId });
    return 'processed';
  }

  private buildOutboundNotification(eventType: SupportedEventType, message: unknown): OutboundNotification {
    switch (eventType) {
      case 'OrderConfirmedV1':
        return this.handleOrderConfirmed.handle(message as OrderConfirmedV1);
      case 'PaymentSucceededV1':
        return this.handlePaymentSucceeded.handle(message as PaymentSucceededV1);
      case 'PaymentFailedV1':
        return this.handlePaymentFailed.handle(message as PaymentFailedV1);
      case 'TicketConfirmedV1':
        return this.handleTicketConfirmed.handle(message as TicketConfirmedV1);
    }
  }
}
