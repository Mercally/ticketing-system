import { CreateTopicCommand, type SNSClient } from '@aws-sdk/client-sns';

/**
 * =====================================================================
 * TOPIC-NAMING ASSUMPTION — the riskiest seam in this service.
 * =====================================================================
 * This service has no MassTransit and therefore cannot compute the SNS
 * topic name the .NET publishers actually use. The .NET side configures
 * `x.SetKebabCaseEndpointNameFormatter()` (CONTRACTS.md §10), which derives
 * each publishable event's SNS topic name from a kebab-case transform of
 * the message type. This build ASSUMES that transform is applied to the
 * FULL namespace-qualified type name, e.g.:
 *
 *   Orders.Contracts.V1.OrderConfirmedV1  ->  orders-contracts-v1-order-confirmed-v1
 *   Payments.Contracts.V1.PaymentSucceededV1 -> payments-contracts-v1-payment-succeeded-v1
 *   Payments.Contracts.V1.PaymentFailedV1 -> payments-contracts-v1-payment-failed-v1
 *   Ticketing.Contracts.V1.TicketConfirmedV1 -> ticketing-contracts-v1-ticket-confirmed-v1
 *
 * These exact strings are ONLY the defaults (see configuration.ts /
 * .env.example) — every topic name is overridable via
 * TOPIC_ORDER_CONFIRMED / TOPIC_PAYMENT_SUCCEEDED / TOPIC_PAYMENT_FAILED /
 * TOPIC_TICKET_CONFIRMED specifically so a real MassTransit-observed name
 * can be substituted without a code change. If MassTransit's actual
 * default topology formats topic names differently (e.g. simple type name
 * only, or a different separator), messages will be published to a topic
 * this service never subscribes to and will silently never arrive here —
 * there is no error, just permanent non-delivery. Confirm the real names
 * against a running LocalStack (`awslocal sns list-topics`) once the .NET
 * publishers are live, and correct these defaults/env vars if they differ.
 * =====================================================================
 */

function looksLikeArn(value: string): boolean {
  return value.startsWith('arn:');
}

/**
 * Resolves a topic reference (env var value) to a full ARN.
 *
 * - If the value already looks like an ARN (`arn:aws:sns:...`), it's used
 *   as-is — this is the expected shape when infra (Terraform) has already
 *   provisioned the topic, i.e. when SKIP_QUEUE_PROVISIONING=true.
 * - Otherwise it's treated as a bare topic name. When `allowCreate` is
 *   true (local dev, provisioning not skipped) we call CreateTopicCommand,
 *   which is idempotent — SNS returns the existing topic's ARN if a topic
 *   with that name already exists (e.g. already created by whichever .NET
 *   publisher booted first), or creates it. When `allowCreate` is false, a
 *   bare name is a configuration error: SKIP_QUEUE_PROVISIONING=true means
 *   this service must not call SNS to create anything.
 */
export async function resolveTopicArn(
  sns: SNSClient,
  envVarName: string,
  value: string,
  allowCreate: boolean,
): Promise<string> {
  if (looksLikeArn(value)) {
    return value;
  }
  if (!allowCreate) {
    throw new Error(
      `${envVarName}="${value}" is not a full SNS topic ARN, and SKIP_QUEUE_PROVISIONING=true means this ` +
        'service will not call SNS to resolve/create it. Set this env var to the full topic ARN provisioned by infra.',
    );
  }
  const result = await sns.send(new CreateTopicCommand({ Name: value }));
  if (!result.TopicArn) {
    throw new Error(`CreateTopicCommand for "${value}" did not return a TopicArn`);
  }
  return result.TopicArn;
}
