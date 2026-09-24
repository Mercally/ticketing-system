# ECS/Fargate module — the primary compute target per ARCHITECTURE.md §10.5 ("ECS/Fargate (or
# EKS)"; Fargate picked as primary since it's listed first). Not applied — see modules/vpc/main.tf.
#
# Shape: one Fargate Service per entry in var.services, all registered in a single Cloud Map
# private DNS namespace for east-west service-to-service calls (Gateway -> Auth/Catalog/Ticketing/
# Orders/Payments, per ARCHITECTURE.md §3's Rel(gateway, ...) lines) — no ALB needed for that
# traffic. Only "gateway" is additionally attached to an INTERNAL ALB, which API Gateway reaches
# through a VPC Link — that's the north-south path or APIGW --> GW in the §10.5 diagram. AWS API
# Gateway itself is provisioned here (not a separate module) because it's tightly coupled to how
# the Gateway service is exposed; modules/cloudfront_waf takes this module's API Gateway invoke
# URL as its CloudFront origin.

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Cluster + Cloud Map (east-west service discovery)
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "${var.name_prefix}.internal"
  vpc         = var.vpc_id
  description = "East-west service discovery — e.g. catalog.${var.name_prefix}.internal resolves to the Catalog service's Fargate tasks."
}

resource "aws_service_discovery_service" "this" {
  for_each = var.services

  name = each.key

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "tasks" {
  name        = "${var.name_prefix}-ecs-tasks-sg"
  description = "Fargate tasks for every service in var.services. Ingress from the ALB SG (gateway only, in practice) and from itself (east-west calls); egress unrestricted (RDS/SQS/SNS/Secrets Manager/internet via NAT)."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-tasks-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 0
  to_port                      = 65535
  description                  = "ALB -> gateway task (and any future ALB-fronted service)"
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_self" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 0
  to_port                      = 65535
  description                  = "East-west: gateway/other services calling each other by Cloud Map DNS name"
}

resource "aws_vpc_security_group_egress_rule" "tasks_all" {
  security_group_id = aws_security_group.tasks.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Internal ALB in front of the gateway service. Reachable only from within the VPC (API Gateway's VPC Link creates ENIs inside these subnets) — never has a public IP or 0.0.0.0/0 ingress."
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_vpc" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_all" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------------------
# Internal ALB (gateway only — see module header comment)
# ---------------------------------------------------------------------------

resource "aws_lb" "internal" {
  name               = "${var.name_prefix}-internal-alb"
  internal           = true
  load_balancer_type = "application"
  subnets            = var.private_subnet_ids
  security_groups    = [aws_security_group.alb.id]

  tags = var.tags
}

resource "aws_lb_target_group" "gateway" {
  name        = "${var.name_prefix}-gateway-tg"
  port        = var.services["gateway"].port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # required for awsvpc network mode (Fargate)

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 15
    timeout             = 5
  }

  tags = var.tags
}

# Plain HTTP is deliberate, not an oversight: this listener is only reachable from inside the VPC
# (aws_security_group.alb has no 0.0.0.0/0 ingress) via API Gateway's VPC Link — TLS is terminated
# at the edge (CloudFront + API Gateway, both HTTPS-only to the client) per ARCHITECTURE.md §10.5.
# A stricter build could still add TLS here using AWS Private CA / ACM private certs; noted as a
# possible hardening step, not done in this skeleton.
resource "aws_lb_listener" "gateway_http" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

# ---------------------------------------------------------------------------
# IAM (shared execution + task roles — PoC-scope simplification, see variables.tf)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "execution_extra" {
  for_each   = toset(var.execution_role_extra_policy_arns)
  role       = aws_iam_role.execution.name
  policy_arn = each.value
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "task_extra" {
  for_each   = toset(var.task_role_extra_policy_arns)
  role       = aws_iam_role.task.name
  policy_arn = each.value
}

# ---------------------------------------------------------------------------
# Per-service: log group, task definition, service
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "this" {
  for_each = var.services

  name              = "/ecs/${var.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_ecs_task_definition" "this" {
  for_each = var.services

  family                   = "${var.name_prefix}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(each.value.cpu)
  memory                   = tostring(each.value.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = each.value.image
      essential = true
      portMappings = [
        { containerPort = each.value.port, protocol = "tcp" }
      ]
      environment = [
        for k, v in each.value.env : { name = k, value = v }
      ]
      secrets = [
        for k, arn in each.value.secretArns : { name = k, valueFrom = arn }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this[each.key].name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = each.key
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "this" {
  for_each = var.services

  name            = "${var.name_prefix}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this[each.key].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.tasks.id]
    # No public IP — every task is private; the "gateway" task is reached via the internal ALB
    # (below), every other task via Cloud Map DNS only.
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.this[each.key].arn
  }

  dynamic "load_balancer" {
    for_each = each.key == "gateway" ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.gateway.arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# API Gateway (HTTP API) -> VPC Link -> internal ALB -> gateway service.
# This is the "API Gateway" box in ARCHITECTURE.md §10.5, sitting between WAF and ECS.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_vpc_link" "this" {
  name               = "${var.name_prefix}-vpc-link"
  security_group_ids = [aws_security_group.alb.id]
  subnet_ids         = var.private_subnet_ids

  tags = var.tags
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "gateway" {
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "HTTP_PROXY"
  integration_uri    = aws_lb_listener.gateway_http.arn
  integration_method = "ANY"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.this.id
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.gateway.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  tags = var.tags
}
