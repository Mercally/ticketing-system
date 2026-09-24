import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { SubscribeCommand, type SNSClient } from '@aws-sdk/client-sns';
import { SNS_CLIENT, SQS_CLIENT } from './aws-clients.module.js';
import { resolveTopicArn } from './topic-arn.util.js';
import { buildSnsToSqsPolicy } from './sns-to-sqs-policy.util.js';
import { StructuredLoggerService } from '../logging/structured-logger.service.js';
import type { AppConfig } from '../config/configuration.js';

const REDRIVE_MAX_RECEIVE_COUNT = 5;

export interface ProvisionResult {
  queueUrl: string;
}

/**
 * At-boot, idempotent provisioning of this service's own SQS queue + DLQ +
 * SNS subscriptions (see ADR-0004, ADR-0009). There is no separate infra
 * provisioning step for local dev (no Terraform apply against LocalStack),
 * so this service creates what it needs itself, guarded by
 * SKIP_QUEUE_PROVISIONING for environments (real AWS) where Terraform has
 * already done it.
 *
 * Every AWS call here is written to be safe to run repeatedly: CreateQueue/
 * CreateTopic are idempotent per AWS semantics when attributes match, and
 * SetQueueAttributes/Subscribe are applied unconditionally afterward so the
 * queue converges to the desired redrive policy/permissions/subscriptions
 * even if it already existed with different attributes.
 */
@Injectable()
export class QueueProvisioningService {
  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(SNS_CLIENT) private readonly sns: SNSClient,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: StructuredLoggerService,
  ) {}

  async ensureInboundQueue(): Promise<ProvisionResult> {
    const queueName = this.config.get('notificationQueueName', { infer: true });

    if (this.config.get('skipQueueProvisioning', { infer: true })) {
      this.logger.log(
        'SKIP_QUEUE_PROVISIONING=true — assuming infra (Terraform) already created the queue, DLQ and subscriptions',
        { queueName },
      );
      const queueUrl = await this.getQueueUrl(queueName);
      return { queueUrl };
    }

    const topics = this.config.get('topics', { infer: true });
    const topicRefs: Array<[string, string]> = [
      ['TOPIC_ORDER_CONFIRMED', topics.orderConfirmed],
      ['TOPIC_PAYMENT_SUCCEEDED', topics.paymentSucceeded],
      ['TOPIC_PAYMENT_FAILED', topics.paymentFailed],
      ['TOPIC_TICKET_CONFIRMED', topics.ticketConfirmed],
    ];
    const inboundTopicArns = await Promise.all(
      topicRefs.map(([envVarName, value]) => resolveTopicArn(this.sns, envVarName, value, true)),
    );

    const dlqName = `${queueName}-dlq`;
    const dlqUrl = await this.ensureQueue(dlqName, {});
    const dlqArn = await this.getQueueArn(dlqUrl);

    const queueUrl = await this.ensureQueue(queueName, {
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: String(REDRIVE_MAX_RECEIVE_COUNT),
      }),
    });
    const queueArn = await this.getQueueArn(queueUrl);

    await this.sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: { Policy: buildSnsToSqsPolicy(queueArn, inboundTopicArns) },
      }),
    );

    await Promise.all(
      inboundTopicArns.map((topicArn) =>
        this.sns.send(
          new SubscribeCommand({
            TopicArn: topicArn,
            Protocol: 'sqs',
            Endpoint: queueArn,
            // Raw delivery: the SQS body is the MassTransit envelope JSON
            // directly, no outer SNS notification wrapper to strip first.
            Attributes: { RawMessageDelivery: 'true' },
          }),
        ),
      ),
    );

    this.logger.log('Provisioned notification queue', {
      queueName,
      dlqName,
      subscribedTopicCount: inboundTopicArns.length,
      redriveMaxReceiveCount: REDRIVE_MAX_RECEIVE_COUNT,
    });

    return { queueUrl };
  }

  private async ensureQueue(name: string, attributes: Record<string, string>): Promise<string> {
    try {
      const created = await this.sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
      if (!created.QueueUrl) {
        throw new Error(`CreateQueueCommand for "${name}" did not return a QueueUrl`);
      }
      return created.QueueUrl;
    } catch (error) {
      if (!isQueueAlreadyExistsError(error)) {
        throw error;
      }
      const queueUrl = await this.getQueueUrl(name);
      if (Object.keys(attributes).length > 0) {
        await this.sqs.send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: attributes }));
      }
      return queueUrl;
    }
  }

  private async getQueueUrl(name: string): Promise<string> {
    const result = await this.sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    if (!result.QueueUrl) {
      throw new Error(`GetQueueUrlCommand for "${name}" did not return a QueueUrl`);
    }
    return result.QueueUrl;
  }

  private async getQueueArn(queueUrl: string): Promise<string> {
    const result = await this.sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
    );
    const arn = result.Attributes?.QueueArn;
    if (!arn) {
      throw new Error(`GetQueueAttributesCommand for "${queueUrl}" did not return QueueArn`);
    }
    return arn;
  }
}

function isQueueAlreadyExistsError(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name ?? '';
  return name === 'QueueNameExists' || name === 'QueueAlreadyExists';
}
