import { SnsOutboundPublisherService } from './sns-outbound-publisher.service.js';
import { StructuredLoggerService } from '../logging/structured-logger.service.js';
import type { OutboundNotification } from '../../domain/outbound-notification.js';

function buildConfigMock() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'topics') {
        return { notificationsOutbound: 'arn:aws:sns:us-east-1:000000000000:notifications-outbound' };
      }
      if (key === 'skipQueueProvisioning') {
        return true; // ARN already fully qualified, so allowCreate is irrelevant here
      }
      throw new Error(`unexpected config key: ${key}`);
    }),
  };
}

const notification: OutboundNotification = {
  type: 'order.confirmed',
  correlationId: 'corr-1',
  orderId: 'order-1',
  message: 'Your order has been confirmed',
  occurredAtUtc: '2026-01-01T00:00:00Z',
};

describe('SnsOutboundPublisherService', () => {
  it('publishes once on the first successful attempt', async () => {
    const sns = { send: vi.fn().mockResolvedValue({}) };
    const publisher = new SnsOutboundPublisherService(sns as any, buildConfigMock() as any, new StructuredLoggerService());

    await publisher.publish(notification);

    expect(sns.send).toHaveBeenCalledTimes(1);
  });

  it('a transient SNS failure followed by a success still results in exactly one successful publish (no duplicate)', async () => {
    const sns = { send: vi.fn().mockRejectedValueOnce(new Error('ThrottlingException')).mockResolvedValueOnce({}) };
    const publisher = new SnsOutboundPublisherService(sns as any, buildConfigMock() as any, new StructuredLoggerService());

    await publisher.publish(notification);

    // Two calls to sns.send (one transient failure + one success), but the
    // caller only ever sees ONE successful publish() resolution — the retry
    // is internal, so callers (InboundMessageProcessor) never double-act on it.
    expect(sns.send).toHaveBeenCalledTimes(2);
  });

  it('sends the notification payload as the SNS message body with correlationId as a message attribute', async () => {
    const sns = { send: vi.fn().mockResolvedValue({}) };
    const publisher = new SnsOutboundPublisherService(sns as any, buildConfigMock() as any, new StructuredLoggerService());

    await publisher.publish(notification);

    const command = sns.send.mock.calls[0][0];
    expect(JSON.parse(command.input.Message)).toEqual(notification);
    expect(command.input.MessageAttributes.correlationId.StringValue).toBe('corr-1');
  });

  it('gives up and propagates the error once retries are exhausted', async () => {
    const sns = { send: vi.fn().mockRejectedValue(new Error('persistent failure')) };
    const publisher = new SnsOutboundPublisherService(sns as any, buildConfigMock() as any, new StructuredLoggerService());

    await expect(publisher.publish(notification)).rejects.toThrow('persistent failure');
  });

  it('resolves the outbound topic ARN only once across multiple publishes (memoized)', async () => {
    const sns = { send: vi.fn().mockResolvedValue({}) };
    const config = buildConfigMock();
    const publisher = new SnsOutboundPublisherService(sns as any, config as any, new StructuredLoggerService());

    await publisher.publish(notification);
    await publisher.publish({ ...notification, orderId: 'order-2' });

    const topicsCalls = config.get.mock.calls.filter((c: unknown[]) => c[0] === 'topics');
    expect(topicsCalls.length).toBe(1);
  });
});
