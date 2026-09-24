output "db_secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.db : k => s.arn }
}

output "jwt_secret_arn" {
  value = aws_secretsmanager_secret.jwt.arn
}

output "read_policy_arn" {
  description = "Pass to modules/ecs's execution_role_extra_policy_arns (and task_role_extra_policy_arns if app code reads secrets directly)."
  value       = aws_iam_policy.read.arn
}
