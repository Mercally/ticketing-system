import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import { SNS_CLIENT } from './aws-clients.module.js';
import { resolveTopicArn } from './topic-arn.util.js';
import { retryWithBackoff } from './retry.util.js';
import { StructuredLoggerService } from '../logging/structured-logger.service.js';
import type { OutboundNotification } from '../../domain/outbound-notification.js';
import type { AppConfig } from '../config/configuration.js';

const PUBLISH_RETRY_ATTEMPTS = 3;
const PUBLISH_RETRY_BASE_DELAY_MS = 100;

/**
 * Publishes to the `notifications-outbound` SNS topic (CONTRACTS.md §9).
 * Retries the publish call itself with bounded exponential backoff against
 * transient AWS errors (throttling, network blips) — this is the "retries
 * ante fallos temporales de SNS" requirement. This is deliberately scoped
 * to just the publish call, not the whole consume-and-process operation:
 * consume-side failures go through SQS's own redrive/DLQ instead (see
 * SqsConsumerService), so a poison outbound payload can't get stuck
 * retrying forever inside a single message-processing attempt.
 */
@Injectable()
export class SnsOutboundPublisherService {
  private outboundTopicArnPromise: Promise<string> | null = null;

  constructor(
    @Inject(SNS_CLIENT) private readonly sns: SNSClient,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: StructuredLoggerService,
  ) {}

  async publish(notification: OutboundNotification): Promise<void> {
    const topicArn = await this.resolveOutboundTopicArn();

    await retryWithBackoff(
      () =>
        this.sns.send(
          new PublishCommand({
            TopicArn: topicArn,
            Message: JSON.stringify(notification),
            MessageAttributes: {
              correlationId: { DataType: 'String', StringValue: notification.correlationId },
              type: { DataType: 'String', StringValue: notification.type },
            },
          }),
        ),
      {
        attempts: PUBLISH_RETRY_ATTEMPTS,
        baseDelayMs: PUBLISH_RETRY_BASE_DELAY_MS,
        onRetry: (attempt, error) =>
          this.logger.warn('Transient SNS publish failure, retrying', {
            correlationId: notification.correlationId,
            orderId: notification.orderId,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          }),
      },
    );

    this.logger.log('Published outbound notification', {
      correlationId: notification.correlationId,
      orderId: notification.orderId,
      type: notification.type,
    });
  }

  /** Memoized: resolved once per process lifetime, not once per publish. */
  private resolveOutboundTopicArn(): Promise<string> {
    if (!this.outboundTopicArnPromise) {
      const ref = this.config.get('topics', { infer: true }).notificationsOutbound;
      const allowCreate = !this.config.get('skipQueueProvisioning', { infer: true });
      this.outboundTopicArnPromise = resolveTopicArn(this.sns, 'TOPIC_NOTIFICATIONS_OUTBOUND', ref, allowCreate);
    }
    return this.outboundTopicArnPromise;
  }
}
