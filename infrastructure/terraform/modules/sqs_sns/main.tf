# SQS/SNS module — real AWS messaging backbone for the target architecture. Locally this is
# played by LocalStack (DECISIONS.md D4; infrastructure/k8s/base/localstack). Not applied — see
# modules/vpc/main.tf's header comment.
#
# Shape: one SNS topic per message type (fan-out pub/sub, matching how MassTransit's AWS SNS+SQS
# transport works), one SQS queue + DLQ per consuming SERVICE (not per message type — a service
# subscribes its single queue to every topic it consumes, per var.subscriptions), with a
# redrive policy moving poison messages to the DLQ after var.max_receive_count deliveries.

resource "aws_sns_topic" "this" {
  for_each = toset(var.topics)

  name = each.value
  tags = var.tags
}

resource "aws_sqs_queue" "dlq" {
  for_each = var.subscriptions

  name                      = "${var.name_prefix}-${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 days — max retention, so poison messages aren't silently lost

  tags = var.tags
}

resource "aws_sqs_queue" "this" {
  for_each = var.subscriptions

  name                       = "${var.name_prefix}-${each.key}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = var.tags
}

# Flatten (consumer, topic) pairs so each queue can subscribe to every topic it needs.
locals {
  subscription_pairs = {
    for pair in flatten([
      for consumer, cfg in var.subscriptions : [
        for topic in cfg.topics : {
          key      = "${consumer}__${topic}"
          consumer = consumer
          topic    = topic
        }
      ]
    ]) : pair.key => pair
  }
}

resource "aws_sqs_queue_policy" "allow_sns" {
  for_each  = var.subscriptions
  queue_url = aws_sqs_queue.this[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSnsPublish"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.this[each.key].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = [
              for topic in each.value.topics : aws_sns_topic.this[topic].arn
            ]
          }
        }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "this" {
  for_each = local.subscription_pairs

  topic_arn = aws_sns_topic.this[each.value.topic].arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.this[each.value.consumer].arn

  raw_message_delivery = true # so consumers get the message body unwrapped, not SNS's envelope
}
