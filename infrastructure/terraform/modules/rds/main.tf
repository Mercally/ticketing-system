# RDS module — five INDEPENDENT PostgreSQL instances, one per service. Per DECISIONS.md D5, local
# Aspire runs five containers and local k8s runs one Postgres process with five databases (to
# spare a laptop cluster five PVCs/pods); this Terraform target is the one environment that
# actually honors "una base de datos independiente por microservicio" at the hosting-cardinality
# level too, not just the logical/credential level. Not applied — see modules/vpc/main.tf's header
# comment for why.
#
# One master password per database is generated here (random_password) rather than accepted as a
# plaintext input variable, specifically so a real `terraform apply` would never require a secret
# to be typed/committed anywhere — modules/secrets reads these back out (as module outputs, which
# Terraform treats as sensitive end-to-end) to populate Secrets Manager.

resource "random_password" "db" {
  for_each = var.databases

  length  = 32
  special = false # simplifies connection-string URL-encoding; still 32 chars of [A-Za-z0-9]
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = var.private_subnet_ids

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-db-subnets"
  })
}

resource "aws_security_group" "db" {
  for_each = var.databases

  name        = "${var.name_prefix}-${each.key}-db-sg"
  description = "Allows Postgres (5432) from ECS tasks only; ${each.key}-db is reachable by no other database's security group."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, {
    Name    = "${var.name_prefix}-${each.key}-db-sg"
    Service = each.key
  })
}

resource "aws_vpc_security_group_ingress_rule" "db" {
  for_each = {
    for pair in flatten([
      for db_key, _ in var.databases : [
        for cidr in var.allowed_cidr_blocks : {
          key    = "${db_key}-${cidr}"
          db_key = db_key
          cidr   = cidr
        }
      ]
    ]) : pair.key => pair
  }

  security_group_id = aws_security_group.db[each.value.db_key].id
  cidr_ipv4         = each.value.cidr
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
  description       = "Postgres from private subnets (ECS tasks) — see allowed_cidr_blocks var comment for why this is CIDR- not SG-scoped"
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  for_each = var.databases

  security_group_id = aws_security_group.db[each.key].id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Default allow-all egress (RDS itself doesn't initiate outbound connections of consequence)"
}

resource "aws_db_instance" "this" {
  for_each = var.databases

  identifier     = "${var.name_prefix}-${each.key}-db"
  engine         = "postgres"
  engine_version = each.value.engine_version

  instance_class    = each.value.instance_class
  allocated_storage = each.value.allocated_storage
  storage_encrypted = true

  db_name  = each.key
  username = each.value.username
  password = random_password.db[each.key].result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db[each.key].id]
  publicly_accessible    = false

  multi_az                = false # PoC-target sizing; flip true for real HA
  backup_retention_period = 7
  skip_final_snapshot     = true # PoC-target convenience; a real prod target would want a final snapshot
  deletion_protection     = false

  tags = merge(var.tags, {
    Name    = "${var.name_prefix}-${each.key}-db"
    Service = each.key
  })
}
