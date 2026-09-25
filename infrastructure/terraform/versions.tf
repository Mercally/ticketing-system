# Structural skeleton for the AWS target architecture (ARCHITECTURE.md §10.5) — per DECISIONS.md
# D4, this is NOT applied against a real AWS account: no AWS credentials are available in this
# environment. Reviewed for syntactic/structural correctness only (`terraform fmt` +
# `terraform validate`), never `terraform plan`/`terraform apply`. See infrastructure/terraform's
# module comments (start with modules/vpc/main.tf) for the same note repeated at the point of use.
#
# Exception: modules/api_gateway_local IS applied, but against LocalStack, not real AWS — see
# infrastructure/aws-local/ (a separate Terraform root with its own provider/state) and
# DECISIONS.md D17.
#
# No backend block is configured on purpose — a real deployment would add an S3 + DynamoDB (or
# Terraform Cloud) backend via `-backend-config`, but declaring one here with placeholder values
# would make even `terraform init` attempt to reach AWS, which this environment has no
# credentials for. Local state is fine for a skeleton nobody applies.

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
