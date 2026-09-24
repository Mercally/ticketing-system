variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "private_subnet_ids" {
  description = "Fargate tasks and the internal ALB both live here — nothing in this module has a public IP. Reachability from outside the VPC is via API Gateway's VPC Link only (see aws_apigatewayv2_vpc_link below), matching ARCHITECTURE.md §10.5's APIGW -> ECS/Fargate box."
  type        = list(string)
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "services" {
  description = <<-EOT
    One entry per ECS service. Keys match ARCHITECTURE.md §4/§11 service names. `public` = true
    only for "gateway" — it's the sole service ARCHITECTURE.md §3 shows receiving inbound traffic
    from outside the platform (APIGW -> GW); every other service is reached only by other services
    via Cloud Map service discovery (east-west), never directly from the internet, matching
    "Gateway ... reverse-proxies to the real services" (DECISIONS.md D1).
  EOT
  type = map(object({
    image      = string
    port       = number
    cpu        = optional(number, 256)
    memory     = optional(number, 512)
    public     = optional(bool, false)
    env        = optional(map(string), {})
    secretArns = optional(map(string), {}) # env var name -> Secrets Manager secret ARN (full ARN, optionally with :key::)
  }))
}

variable "task_role_extra_policy_arns" {
  description = "Additional IAM policy ARNs (e.g. from modules/sqs_sns) attached to every task role so service CODE can call SQS/SNS at runtime. Kept generic/shared rather than per-service least-privilege, which is a PoC-scope simplification — a hardened build would scope each service's task role to only the queues/topics it actually owns."
  type        = list(string)
  default     = []
}

variable "execution_role_extra_policy_arns" {
  description = <<-EOT
    Additional IAM policy ARNs attached to the EXECUTION role (distinct from the task role above).
    This is what the ECS agent itself uses to resolve container-definition `secrets` blocks
    (valueFrom a Secrets Manager ARN) BEFORE the container starts — AmazonECSTaskExecutionRolePolicy
    alone does not grant secretsmanager:GetSecretValue. Pass modules/secrets' read policy ARN here;
    getting execution-role vs. task-role permissions swapped is a common real-world ECS+Secrets
    Manager mistake, called out explicitly rather than left implicit.
  EOT
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
