/**
 * Builds the SQS queue policy that authorizes SNS to deliver messages from
 * a specific set of topics into this queue. Required for real AWS (SNS ->
 * SQS delivery is otherwise denied by default); LocalStack's community
 * edition doesn't enforce this, but setting it is the correct behavior in
 * both environments and keeps local/prod parity (ADR-0004's whole point).
 */
export function buildSnsToSqsPolicy(queueArn: string, topicArns: readonly string[]): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowSnsToSendToNotificationQueue',
        Effect: 'Allow',
        Principal: { Service: 'sns.amazonaws.com' },
        Action: 'sqs:SendMessage',
        Resource: queueArn,
        Condition: {
          ArnEquals: { 'aws:SourceArn': [...topicArns] },
        },
      },
    ],
  });
}
