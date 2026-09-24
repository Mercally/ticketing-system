output "cluster_id" {
  value = aws_ecs_cluster.this.id
}

output "tasks_security_group_id" {
  description = "Passed to modules/rds as an allowed ingress source, so only ECS tasks (not the whole VPC) can reach Postgres."
  value       = aws_security_group.tasks.id
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "api_gateway_invoke_url" {
  description = "Consumed by modules/cloudfront_waf as its CloudFront origin — this is the APIGW box in ARCHITECTURE.md §10.5."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "cloud_map_namespace" {
  value = aws_service_discovery_private_dns_namespace.this.name
}
