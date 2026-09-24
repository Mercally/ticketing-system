import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import type { AppConfig } from '../config/configuration.js';

export const SQS_CLIENT = Symbol('SQS_CLIENT');
export const SNS_CLIENT = Symbol('SNS_CLIENT');

/**
 * AWS SDK v3 clients are used directly (not MassTransit, which is .NET-only
 * — see ADR-0004/ADR-0009). `@opentelemetry/auto-instrumentations-node`
 * instruments these clients automatically once `tracing.ts` has run, so
 * every SQS/SNS call shows up as a span with no extra code here.
 */
function buildClientConfig(config: ConfigService<AppConfig, true>) {
  const aws = config.get('aws', { infer: true });
  return {
    region: aws.region,
    // Left undefined for real AWS unless AWS_ENDPOINT_URL is set (LocalStack locally).
    endpoint: aws.endpointUrl,
    credentials:
      aws.accessKeyId && aws.secretAccessKey
        ? { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey }
        : undefined,
  };
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => new SQSClient(buildClientConfig(config)),
    },
    {
      provide: SNS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => new SNSClient(buildClientConfig(config)),
    },
  ],
  exports: [SQS_CLIENT, SNS_CLIENT],
})
export class AwsClientsModule {}
