import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './infrastructure/prisma/prisma.service.js';
import { AwsClientsModule } from './infrastructure/messaging/aws-clients.module.js';
import { QueueProvisioningService } from './infrastructure/messaging/queue-provisioning.service.js';
import { SnsOutboundPublisherService } from './infrastructure/messaging/sns-outbound-publisher.service.js';
import { SqsConsumerService } from './infrastructure/messaging/sqs-consumer.service.js';
import { StructuredLoggerService } from './infrastructure/logging/structured-logger.service.js';
import { InboxService } from './application/services/inbox.service.js';
import { InboundMessageProcessor } from './application/services/inbound-message-processor.service.js';
import { HandleOrderConfirmedUseCase } from './application/use-cases/handle-order-confirmed.use-case.js';
import { HandlePaymentSucceededUseCase } from './application/use-cases/handle-payment-succeeded.use-case.js';
import { HandlePaymentFailedUseCase } from './application/use-cases/handle-payment-failed.use-case.js';
import { HandleTicketConfirmedUseCase } from './application/use-cases/handle-ticket-confirmed.use-case.js';

/**
 * Wires the four layers together (Controllers / Application / Domain /
 * Infrastructure — ADR-0009). `SqsConsumerService` is listed as a provider
 * purely so Nest instantiates it and drives its OnModuleInit/OnModuleDestroy
 * lifecycle hooks; nothing else injects it directly.
 */
@Module({
  imports: [ConfigModule, AwsClientsModule],
  controllers: [HealthController],
  providers: [
    StructuredLoggerService,
    PrismaService,
    InboxService,
    HandleOrderConfirmedUseCase,
    HandlePaymentSucceededUseCase,
    HandlePaymentFailedUseCase,
    HandleTicketConfirmedUseCase,
    SnsOutboundPublisherService,
    QueueProvisioningService,
    InboundMessageProcessor,
    SqsConsumerService,
  ],
})
export class NotificationModule {}
