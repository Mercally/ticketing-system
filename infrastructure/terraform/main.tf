# Root module — wires vpc -> {rds, sqs_sns} -> secrets -> ecs -> cloudfront_waf for the AWS
# target architecture (ARCHITECTURE.md §10.5). NOT applied (DECISIONS.md D4) — see versions.tf's
# header comment. Module call order below follows the actual data-dependency order; see
# modules/rds/variables.tf's allowed_cidr_blocks comment for the one place a would-be circular
# dependency (rds -> ecs -> secrets -> rds) was deliberately avoided.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, { Environment = var.environment })
  }
}

# WAFv2 web ACLs scoped to CLOUDFRONT must live in us-east-1 regardless of var.aws_region — an AWS
# platform requirement (modules/cloudfront_waf/versions.tf explains why this alias exists).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = merge(var.tags, { Environment = var.environment })
  }
}

locals {
  name_prefix = "${var.name_prefix}-${var.environment}"
}

module "vpc" {
  source = "./modules/vpc"

  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
  azs         = var.azs
  tags        = var.tags
}

module "rds" {
  source = "./modules/rds"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  # Whole-VPC CIDR rather than duplicating modules/vpc's private-subnet CIDR list here — nothing
  # in the public subnets (NAT gateways only) has a legitimate reason to reach Postgres, and this
  # avoids two modules needing to agree on a hardcoded subnet-CIDR list out of band.
  allowed_cidr_blocks = [module.vpc.vpc_cidr]
  tags                = var.tags
}

module "sqs_sns" {
  source = "./modules/sqs_sns"

  name_prefix = local.name_prefix
  tags        = var.tags
}

module "secrets" {
  source = "./modules/secrets"

  name_prefix  = local.name_prefix
  db_endpoints = module.rds.endpoints
  db_names     = module.rds.db_names
  db_usernames = module.rds.usernames
  db_passwords = module.rds.passwords
  tags         = var.tags
}

# IAM policy granting ECS task-role code (not the execution role) SQS/SNS access at runtime —
# MassTransit's AWS transport calls these APIs directly from inside each service, so the
# credentials need to come from the TASK role, unlike Secrets Manager which the execution role
# resolves before the container even starts (see modules/ecs/variables.tf's comment on the two
# roles' different jobs).
data "aws_iam_policy_document" "messaging_access" {
  statement {
    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sns:Publish",
    ]
    resources = module.sqs_sns.resource_arns
  }
}

resource "aws_iam_policy" "messaging_access" {
  name        = "${local.name_prefix}-messaging-access"
  description = "SQS/SNS access for this platform's own topics/queues/DLQs only (modules/sqs_sns), attached to the ECS task role."
  policy      = data.aws_iam_policy_document.messaging_access.json
  tags        = var.tags
}

locals {
  # Cloud Map DNS pattern is deterministic from modules/ecs's own construction
  # ("${name_prefix}.internal" — see modules/ecs/main.tf), so downstream-service URLs can be
  # computed here without an output-based dependency on the ecs module itself (that module is
  # what CREATES these DNS names, so it can't also consume them as an input for itself).
  internal_dns_suffix = "${local.name_prefix}.internal"

  # docs/CONTRACTS.md §1 ports.
  service_ports = {
    gateway              = 5000
    auth-service         = 5001
    catalog              = 5002
    ticketing            = 5003
    orders               = 5004
    payments             = 5005
    fakepaymentgateway   = 5006
    notification-service = 5007
  }

  common_env = {
    AWS_REGION = var.aws_region
    # Unlike the local k8s scaffold (infrastructure/k8s/base/*/configmap.yaml), real AWS needs
    # no AWS_ENDPOINT_URL override and no static AWS_ACCESS_KEY_ID/SECRET — the ECS task role
    # (aws_iam_role.task in modules/ecs, granted aws_iam_policy.messaging_access above) supplies
    # credentials automatically via the container credential provider. LocalStack's dummy "test"
    # creds are a local-only concern, not carried over here.
  }

  services = {
    gateway = {
      image  = var.service_images["gateway"]
      port   = local.service_ports["gateway"]
      public = true
      env = merge(local.common_env, {
        ASPNETCORE_ENVIRONMENT = "Production"
        ASPNETCORE_HTTP_PORTS  = tostring(local.service_ports["gateway"])
        AUTH_SERVICE_URL       = "http://auth-service.${local.internal_dns_suffix}:${local.service_ports["auth-service"]}"
        CATALOG_SERVICE_URL    = "http://catalog.${local.internal_dns_suffix}:${local.service_ports["catalog"]}"
        TICKETING_SERVICE_URL  = "http://ticketing.${local.internal_dns_suffix}:${local.service_ports["ticketing"]}"
        ORDERS_SERVICE_URL     = "http://orders.${local.internal_dns_suffix}:${local.service_ports["orders"]}"
        PAYMENTS_SERVICE_URL   = "http://payments.${local.internal_dns_suffix}:${local.service_ports["payments"]}"
        # Gateway's Redis (waiting-room/rate-limit ONLY, DECISIONS.md D11) is real ElastiCache in
        # this target, not modeled as its own module here — ARCHITECTURE.md §10.5 draws it as a
        # single box in the "Data" subgraph; adding an elasticache module would be a reasonable
        # follow-up but wasn't in this task's required module list.
      })
      secretArns = {}
    }

    auth-service = {
      image = var.service_images["auth-service"]
      port  = local.service_ports["auth-service"]
      env = merge(local.common_env, {
        NODE_ENV = "production"
        PORT     = tostring(local.service_ports["auth-service"])
      })
      secretArns = {
        DATABASE_URL = "${module.secrets.db_secret_arns["auth"]}:prismaUrl::"
        JWT_SECRET   = module.secrets.jwt_secret_arn
      }
    }

    catalog = {
      image = var.service_images["catalog"]
      port  = local.service_ports["catalog"]
      env = merge(local.common_env, {
        ASPNETCORE_ENVIRONMENT = "Production"
        ASPNETCORE_HTTP_PORTS  = tostring(local.service_ports["catalog"])
      })
      secretArns = {
        ConnectionStrings__catalog = "${module.secrets.db_secret_arns["catalog"]}:connectionString::"
      }
    }

    ticketing = {
      image = var.service_images["ticketing"]
      port  = local.service_ports["ticketing"]
      env = merge(local.common_env, {
        ASPNETCORE_ENVIRONMENT = "Production"
        ASPNETCORE_HTTP_PORTS  = tostring(local.service_ports["ticketing"])
      })
      secretArns = {
        ConnectionStrings__ticketing = "${module.secrets.db_secret_arns["ticketing"]}:connectionString::"
        JWT_SECRET                   = module.secrets.jwt_secret_arn
      }
    }

    orders = {
      image = var.service_images["orders"]
      port  = local.service_ports["orders"]
      env = merge(local.common_env, {
        ASPNETCORE_ENVIRONMENT = "Production"
        ASPNETCORE_HTTP_PORTS  = tostring(local.service_ports["orders"])
      })
      secretArns = {
        ConnectionStrings__orders = "${module.secrets.db_secret_arns["orders"]}:connectionString::"
        JWT_SECRET                = module.secrets.jwt_secret_arn
      }
    }

    payments = {
      image = var.service_images["payments"]
      port  = local.service_ports["payments"]
      env = merge(local.common_env, {
        ASPNETCORE_ENVIRONMENT   = "Production"
        ASPNETCORE_HTTP_PORTS    = tostring(local.service_ports["payments"])
        FAKE_PAYMENT_GATEWAY_URL = "http://fakepaymentgateway.${local.internal_dns_suffix}:${local.service_ports["fakepaymentgateway"]}"
      })
      secretArns = {
        ConnectionStrings__payments = "${module.secrets.db_secret_arns["payments"]}:connectionString::"
      }
    }

    fakepaymentgateway = {
      image = var.service_images["fakepaymentgateway"]
      port  = local.service_ports["fakepaymentgateway"]
      env = merge(local.common_env, {
        ASPNETCORE_ENVIRONMENT = "Production"
        ASPNETCORE_HTTP_PORTS  = tostring(local.service_ports["fakepaymentgateway"])
      })
      secretArns = {}
    }

    notification-service = {
      image = var.service_images["notification-service"]
      port  = local.service_ports["notification-service"]
      env = merge(local.common_env, {
        NODE_ENV = "production"
        PORT     = tostring(local.service_ports["notification-service"])
      })
      secretArns = {}
    }
  }
}

module "ecs" {
  source = "./modules/ecs"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  vpc_cidr           = module.vpc.vpc_cidr
  private_subnet_ids = module.vpc.private_subnet_ids

  services = local.services

  execution_role_extra_policy_arns = [module.secrets.read_policy_arn]
  task_role_extra_policy_arns      = [aws_iam_policy.messaging_access.arn, module.secrets.read_policy_arn]

  tags = var.tags
}

module "cloudfront_waf" {
  source = "./modules/cloudfront_waf"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = local.name_prefix
  # API Gateway's invoke URL is "https://<id>.execute-api.<region>.amazonaws.com/" — CloudFront's
  # origin_domain_name wants just the host, so the scheme is stripped here.
  origin_domain_name = replace(replace(module.ecs.api_gateway_invoke_url, "https://", ""), "/", "")

  tags = var.tags
}
