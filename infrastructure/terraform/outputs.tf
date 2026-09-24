output "vpc_id" {
  value = module.vpc.vpc_id
}

output "rds_endpoints" {
  description = "Map of database key -> host:port for each of the five independent RDS instances (DECISIONS.md D5)."
  value       = module.rds.endpoints
}

output "sns_topic_arns" {
  value = module.sqs_sns.topic_arns
}

output "sqs_queue_arns" {
  value = module.sqs_sns.queue_arns
}

output "secrets_db_arns" {
  value = module.secrets.db_secret_arns
}

output "jwt_secret_arn" {
  value = module.secrets.jwt_secret_arn
}

output "ecs_cluster_id" {
  value = module.ecs.cluster_id
}

output "api_gateway_invoke_url" {
  value = module.ecs.api_gateway_invoke_url
}

output "cloudfront_domain_name" {
  value = module.cloudfront_waf.distribution_domain_name
}
