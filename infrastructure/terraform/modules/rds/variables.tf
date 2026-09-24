variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  description = "Private subnet ids to place the DB subnet group in — RDS instances get no public IP."
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = <<-EOT
    CIDR blocks allowed to reach Postgres on 5432 — in practice the private subnet CIDRs that
    ECS tasks run in (modules/vpc's private_subnet_cidrs). A security-group-reference rule (only
    the ECS tasks SG, by ID) would be tighter, but modules/ecs's task role needs
    modules/secrets' read policy ARN, modules/secrets needs modules/rds' outputs, and modules/rds
    would then need modules/ecs' security group ID — a genuine module dependency cycle. CIDR-based
    ingress, scoped to "private subnets only" rather than "this exact SG", breaks that cycle at
    the cost of some precision; still excludes the public subnets and the internet entirely.
  EOT
  type        = list(string)
}

variable "databases" {
  description = <<-EOT
    One entry per service database — per DECISIONS.md D5, this is the ONE environment that gets
    true per-service instances (unlike local Aspire/k8s, which share Postgres processes/containers).
    Keys match the database names created locally: auth, catalog, ticketing, orders, payments.
  EOT
  type = map(object({
    engine_version    = optional(string, "16.4")
    instance_class    = optional(string, "db.t4g.micro")
    allocated_storage = optional(number, 20)
    username          = optional(string, "app_user")
  }))
  default = {
    auth      = {}
    catalog   = {}
    ticketing = {}
    orders    = {}
    payments  = {}
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
