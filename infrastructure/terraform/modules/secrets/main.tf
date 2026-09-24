# Secrets Manager module. Not applied — see modules/vpc/main.tf's header comment. Structurally,
# this is what infrastructure/k8s/base/*/secret.yaml's LOCAL-DEV-ONLY placeholders graduate into
# for the real AWS target: one Secrets Manager entry per service database (connection info as a
# JSON blob, matching the shape each .NET/Prisma service would read) plus one for the shared JWT
# signing secret.

resource "aws_secretsmanager_secret" "db" {
  for_each = var.db_endpoints

  name        = "${var.name_prefix}/${each.key}-db"
  description = "Connection info for the ${each.key} service's independent RDS instance (DECISIONS.md D5)."
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "db" {
  for_each = var.db_endpoints

  secret_id = aws_secretsmanager_secret.db[each.key].id
  secret_string = jsonencode({
    host     = split(":", each.value)[0]
    port     = 5432
    dbname   = var.db_names[each.key]
    username = var.db_usernames[each.key]
    password = var.db_passwords[each.key]
    # Convenience full connection strings in BOTH shapes this platform actually needs (see
    # ARCHITECTURE.md §11 — .NET services use Npgsql/EF Core, auth-service uses Prisma), so
    # neither stack has to reassemble one from the discrete fields above. ECS task definitions
    # (modules/ecs) reference these by JSON key, e.g. "<this-secret-arn>:connectionString::".
    connectionString = "Host=${split(":", each.value)[0]};Port=5432;Database=${var.db_names[each.key]};Username=${var.db_usernames[each.key]};Password=${var.db_passwords[each.key]}"
    prismaUrl        = "postgresql://${var.db_usernames[each.key]}:${var.db_passwords[each.key]}@${split(":", each.value)[0]}:5432/${var.db_names[each.key]}?schema=public"
  })
}

resource "random_password" "jwt" {
  length  = var.jwt_secret_length
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name        = "${var.name_prefix}/jwt-signing-secret"
  description = "Shared HS256 signing secret (docs/CONTRACTS.md §3) — Auth Service issues, other services validate. Centralizing it here (vs. the k8s scaffold's duplicated literal, see infrastructure/k8s/base/auth-service/secret.yaml's comment) is exactly what this module is for."
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

# ---------------------------------------------------------------------------
# IAM read policy — attach to ECS's EXECUTION role (container-definition `secrets` resolution)
# and/or TASK role (if application code also reads Secrets Manager directly at runtime, e.g. to
# rotate or re-fetch). See modules/ecs/variables.tf's execution_role_extra_policy_arns comment for
# why these are two different roles with two different jobs.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "read" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [for s in aws_secretsmanager_secret.db : s.arn],
      [aws_secretsmanager_secret.jwt.arn],
    )
  }
}

resource "aws_iam_policy" "read" {
  name        = "${var.name_prefix}-secrets-read"
  description = "Read access to this platform's Secrets Manager entries only (not account-wide) — attach to ECS execution/task roles."
  policy      = data.aws_iam_policy_document.read.json
  tags        = var.tags
}
