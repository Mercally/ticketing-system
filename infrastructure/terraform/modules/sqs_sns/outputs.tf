output "topic_arns" {
  value = { for k, t in aws_sns_topic.this : k => t.arn }
}

output "queue_arns" {
  value = { for k, q in aws_sqs_queue.this : k => q.arn }
}

output "dlq_arns" {
  value = { for k, q in aws_sqs_queue.dlq : k => q.arn }
}

output "resource_arns" {
  description = "Every topic + queue + DLQ ARN, flattened — handy for building an IAM policy granting a task role access to all of them (see root main.tf, modules/ecs task_role_extra_policy_arns)."
  value = concat(
    [for t in aws_sns_topic.this : t.arn],
    [for q in aws_sqs_queue.this : q.arn],
    [for q in aws_sqs_queue.dlq : q.arn],
  )
}
