import { InboundMessageProcessor } from './inbound-message-processor.service.js';
import { InboxService } from './inbox.service.js';
import { HandleOrderConfirmedUseCase } from '../use-cases/handle-order-confirmed.use-case.js';
import { HandlePaymentSucceededUseCase } from '../use-cases/handle-payment-succeeded.use-case.js';
import { HandlePaymentFailedUseCase } from '../use-cases/handle-payment-failed.use-case.js';
import { HandleTicketConfirmedUseCase } from '../use-cases/handle-ticket-confirmed.use-case.js';
import { SnsOutboundPublisherService } from '../../infrastructure/messaging/sns-outbound-publisher.service.js';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service.js';
import type { MassTransitEnvelope } from '../dto/masstransit-envelope.js';
import type { OrderConfirmedV1, PaymentFailedV1 } from '../dto/consumed-events.js';

function envelope<T>(messageId: string, typeSuffix: string, message: T): string {
  const body: MassTransitEnvelope<T> = {
    messageId,
    messageType: [`urn:message:Orders.Contracts.V1:${typeSuffix}`],
    message,
  };
  return JSON.stringify(body);
}

function buildProcessor(overrides?: { inbox?: Partial<InboxService> }) {
  const inbox = {
    isAlreadyProcessed: vi.fn().mockResolvedValue(false),
    markProcessed: vi.fn().mockResolvedValue('inserted'),
    ...overrides?.inbox,
  } as unknown as InboxService;

  const publisher = { publish: vi.fn().mockResolvedValue(undefined) } as unknown as SnsOutboundPublisherService;

  const processor = new InboundMessageProcessor(
    inbox,
    new HandleOrderConfirmedUseCase(),
    new HandlePaymentSucceededUseCase(),
    new HandlePaymentFailedUseCase(),
    new HandleTicketConfirmedUseCase(),
    publisher,
    new StructuredLoggerService(),
  );

  return { processor, inbox, publisher };
}

const orderConfirmed: OrderConfirmedV1 = {
  OrderId: 'order-1',
  EventId: 'event-1',
  SeatId: 'seat-1',
  BuyerId: 'buyer-1',
  Amount: 89.99,
  ConfirmedAtUtc: '2026-01-01T00:00:00Z',
  CorrelationId: 'corr-abc',
};

const paymentFailed: PaymentFailedV1 = {
  OrderId: 'order-2',
  Reason: 'card_declined',
  FailedAtUtc: '2026-01-01T00:05:00Z',
  CorrelationId: 'corr-xyz',
};

describe('InboundMessageProcessor', () => {
  it('duplicate delivery of the same messageId is a no-op: the use-case and publisher never run a second time', async () => {
    const { processor, publisher } = buildProcessor();
    const body = envelope('msg-dup', 'OrderConfirmedV1', orderConfirmed);

    const first = await processor.process(body);
    expect(first).toBe('processed');
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    // Second delivery of the exact same messageId: inbox now reports it as seen.
    const { processor: processorForRedelivery, inbox: inboxForRedelivery, publisher: publisherForRedelivery } =
      buildProcessor({ inbox: { isAlreadyProcessed: vi.fn().mockResolvedValue(true) } });

    const second = await processorForRedelivery.process(body);
    expect(second).toBe('duplicate-skipped');
    expect(publisherForRedelivery.publish).not.toHaveBeenCalled();
    expect(inboxForRedelivery.markProcessed).not.toHaveBeenCalled();
  });

  it('a race-lost inbox insert (already-processed) after successful processing does not fail the operation', async () => {
    const { processor, publisher } = buildProcessor({
      inbox: { markProcessed: vi.fn().mockResolvedValue('already-processed') },
    });

    await expect(processor.process(envelope('msg-race', 'OrderConfirmedV1', orderConfirmed))).resolves.toBe('processed');
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('publishes the correct outbound shape for OrderConfirmedV1', async () => {
    const { processor, publisher } = buildProcessor();
    await processor.process(envelope('msg-oc', 'OrderConfirmedV1', orderConfirmed));

    expect(publisher.publish).toHaveBeenCalledWith({
      type: 'order.confirmed',
      correlationId: 'corr-abc',
      orderId: 'order-1',
      message: 'Your order has been confirmed',
      occurredAtUtc: '2026-01-01T00:00:00Z',
    });
  });

  it('publishes the correct outbound shape for PaymentFailedV1, including the failure reason', async () => {
    const { processor, publisher } = buildProcessor();
    await processor.process(envelope('msg-pf', 'PaymentFailedV1', paymentFailed));

    const published = (publisher.publish as any).mock.calls[0][0];
    expect(published.type).toBe('payment.failed');
    expect(published.orderId).toBe('order-2');
    expect(published.message).toContain('card_declined');
  });

  it('propagates the CorrelationId from the inbound payload to the outbound publish, unchanged', async () => {
    const { processor, publisher } = buildProcessor();
    await processor.process(envelope('msg-corr', 'OrderConfirmedV1', orderConfirmed));

    const published = (publisher.publish as any).mock.calls[0][0];
    expect(published.correlationId).toBe(orderConfirmed.CorrelationId);
  });

  it('throws for an unsupported/unrecognized message type rather than silently dropping it', async () => {
    const { processor } = buildProcessor();
    const body = envelope('msg-unknown', 'SomethingElseV1', { foo: 'bar' });

    await expect(processor.process(body)).rejects.toThrow();
  });
});
