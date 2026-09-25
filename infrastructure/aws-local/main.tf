# Root Terraform config applying modules/api_gateway_local against the host-level LocalStack
# (docker-compose.yaml in this same directory) — see DECISIONS.md D17 for the "why". Separate
# state from infrastructure/terraform's real-AWS skeleton on purpose: different provider
# (LocalStack endpoints), different lifecycle (this one is actually applied/destroyed
# routinely), no reason to share a state file.

locals {
  frontend_origin = "http://${var.frontend_bucket_name}.s3-website.localhost.localstack.cloud:4566"
}

module "api_gateway" {
  source = "../terraform/modules/api_gateway_local"

  name_prefix = "ticketing-local"
  jwt_secret  = var.jwt_secret

  backend_urls = {
    auth      = "http://host.docker.internal:${var.backend_ports.auth}"
    catalog   = "http://host.docker.internal:${var.backend_ports.catalog}"
    ticketing = "http://host.docker.internal:${var.backend_ports.ticketing}"
    orders    = "http://host.docker.internal:${var.backend_ports.orders}"
    payments  = "http://host.docker.internal:${var.backend_ports.payments}"
  }

  allowed_origin       = local.frontend_origin
  frontend_bucket_name = var.frontend_bucket_name

  tags = {
    Project = "ticketing-platform"
    Scope   = "local-hands-on"
  }
}

output "invoke_url" {
  value = module.api_gateway.invoke_url
}

output "frontend_website_endpoint" {
  value = module.api_gateway.frontend_website_endpoint
}

output "frontend_bucket" {
  value = module.api_gateway.frontend_bucket
}
