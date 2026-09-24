/**
 * Typed configuration factory for @nestjs/config (registered via
 * `ConfigModule.forRoot({ load: [configuration] })` in AppModule).
 *
 * Env vars, per CONTRACTS.md §9 and the service's task spec:
 * PORT, DATABASE_URL, AWS_ENDPOINT_URL, AWS_REGION, NOTIFICATION_QUEUE_NAME,
 * TOPIC_ORDER_CONFIRMED, TOPIC_PAYMENT_SUCCEEDED, TOPIC_PAYMENT_FAILED,
 * TOPIC_TICKET_CONFIRMED, TOPIC_NOTIFICATIONS_OUTBOUND,
 * SKIP_QUEUE_PROVISIONING, OTEL_EXPORTER_OTLP_ENDPOINT.
 */
export interface AppConfig {
  port: number;
  databaseUrl: string | undefined;
  aws: {
    endpointUrl: string | undefined;
    region: string;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  };
  notificationQueueName: string;
  topics: {
    orderConfirmed: string;
    paymentSucceeded: string;
    paymentFailed: string;
    ticketConfirmed: string;
    notificationsOutbound: string;
  };
  skipQueueProvisioning: boolean;
  otelExporterOtlpEndpoint: string;
}

export default function configuration(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 5007),
    databaseUrl: process.env.DATABASE_URL,
    aws: {
      // Left undefined (not defaulted to LocalStack) when unset, so the AWS
      // SDK falls back to real regional endpoints in prod. .env.example
      // documents the local LocalStack default (http://localhost:4566).
      endpointUrl: process.env.AWS_ENDPOINT_URL || undefined,
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    notificationQueueName: process.env.NOTIFICATION_QUEUE_NAME || 'notification-service-queue',
    topics: {
      // Defaults assume MassTransit's default SetKebabCaseEndpointNameFormatter
      // topology: full namespace-qualified type name, kebab-cased. See
      // src/infrastructure/messaging/topic-arn.util.ts for the detailed
      // assumption and risk note.
      orderConfirmed: process.env.TOPIC_ORDER_CONFIRMED || 'orders-contracts-v1-order-confirmed-v1',
      paymentSucceeded: process.env.TOPIC_PAYMENT_SUCCEEDED || 'payments-contracts-v1-payment-succeeded-v1',
      paymentFailed: process.env.TOPIC_PAYMENT_FAILED || 'payments-contracts-v1-payment-failed-v1',
      ticketConfirmed: process.env.TOPIC_TICKET_CONFIRMED || 'ticketing-contracts-v1-ticket-confirmed-v1',
      notificationsOutbound: process.env.TOPIC_NOTIFICATIONS_OUTBOUND || 'notifications-outbound',
    },
    skipQueueProvisioning: (process.env.SKIP_QUEUE_PROVISIONING || 'false').toLowerCase() === 'true',
    otelExporterOtlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  };
}
