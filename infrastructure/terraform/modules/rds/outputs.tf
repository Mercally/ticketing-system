output "endpoints" {
  description = "Map of database key -> host:port endpoint."
  value       = { for k, db in aws_db_instance.this : k => db.endpoint }
}

output "addresses" {
  description = "Map of database key -> hostname only (no port)."
  value       = { for k, db in aws_db_instance.this : k => db.address }
}

output "usernames" {
  value = { for k, db in aws_db_instance.this : k => db.username }
}

output "passwords" {
  description = "Map of database key -> generated master password. Sensitive."
  value       = { for k, p in random_password.db : k => p.result }
  sensitive   = true
}

output "db_names" {
  value = { for k, db in aws_db_instance.this : k => db.db_name }
}
