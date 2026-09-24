import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeleteMessageCommand, ReceiveMessageCommand, type Message, type SQSClient } from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from './aws-clients.module.js';
import { QueueProvisioningService } from './queue-provisioning.service.js';
import { InboundMessageProcessor } from '../../application/services/inbound-message-processor.service.js';
import { StructuredLoggerService } from '../logging/structured-logger.service.js';

const MAX_MESSAGES_PER_POLL = 10;
const LONG_POLL_WAIT_SECONDS = 20;
/** Backoff after a ReceiveMessage-level failure (network/AWS outage), so we don't hot-loop against a down endpoint. */
const RECEIVE_ERROR_BACKOFF_MS = 1000;

/**
 * Long-poll SQS consumer, run as a Nest lifecycle-hooked service. On
 * `onModuleInit` it provisions the queue (unless skipped) and starts an
 * internal poll loop; `onModuleDestroy` signals the loop to stop and awaits
 * its current iteration for a graceful shutdown (no message is left
 * mid-flight when the process exits — `main.ts` calls
 * `app.enableShutdownHooks()` so this fires on SIGTERM).
 *
 * Deliberately thin: all it does is receive, hand off to
 * InboundMessageProcessor, and delete on success. The actual dedupe/publish
 * logic lives in InboundMessageProcessor precisely so it can be unit-tested
 * without a poll loop or timers.
 */
@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private queueUrl: string | null = null;
  private stopping = false;
  private pollLoop: Promise<void> | null = null;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly provisioning: QueueProvisioningService,
    private readonly processor: InboundMessageProcessor,
    private readonly logger: StructuredLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { queueUrl } = await this.provisioning.ensureInboundQueue();
    this.queueUrl = queueUrl;
    this.logger.log('Starting SQS long-poll consumer', { queueUrl });
    this.pollLoop = this.runPollLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.pollLoop) {
      await this.pollLoop;
    }
    this.logger.log('SQS consumer stopped gracefully');
  }

  private async runPollLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const result = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl!,
            MaxNumberOfMessages: MAX_MESSAGES_PER_POLL,
            WaitTimeSeconds: LONG_POLL_WAIT_SECONDS,
            MessageAttributeNames: ['All'],
          }),
        );

        for (const message of result.Messages ?? []) {
          if (this.stopping) {
            break;
          }
          await this.handleOne(message);
        }
      } catch (error) {
        this.logger.error('SQS receive loop error', { error: error instanceof Error ? error.message : String(error) });
        await sleep(RECEIVE_ERROR_BACKOFF_MS);
      }
    }
  }

  private async handleOne(message: Message): Promise<void> {
    try {
      await this.processor.process(message.Body ?? '');
      await this.ack(message);
    } catch (error) {
      // Left un-acked on purpose: SQS's visibility timeout will expire and
      // redeliver it, up to the redrive policy's maxReceiveCount, after
      // which it lands in the DLQ. Poison messages here can never affect
      // Order/Payment/Ticketing — there is no path back into their data.
      this.logger.error('Failed to process SQS message; leaving for redelivery/DLQ', {
        sqsMessageId: message.MessageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async ack(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }
    await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl!, ReceiptHandle: message.ReceiptHandle }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
