variable "aws_region" {
  description = "Primary AWS region for everything except the CloudFront WAF web ACL (which AWS requires in us-east-1 regardless — see modules/cloudfront_waf/versions.tf)."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix applied to every resource name/tag across all modules, e.g. \"ticketing-dev\"."
  type        = string
  default     = "ticketing"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "azs" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "service_images" {
  description = <<-EOT
    Container image URI per ECS service (ECR repo:tag, filled in by CI once images are pushed —
    left as a plain map input here rather than an ECR module, since this repo's images are
    presently built locally per infrastructure/docker/README.md, not published anywhere).
    Placeholder defaults point at a not-yet-created ECR namespace; a real apply would override
    every one of these.
  EOT
  type        = map(string)
  default = {
    gateway              = "PLACEHOLDER_ECR_URI/ticketing/gateway:latest"
    auth-service         = "PLACEHOLDER_ECR_URI/ticketing/auth-service:latest"
    catalog              = "PLACEHOLDER_ECR_URI/ticketing/catalog:latest"
    ticketing            = "PLACEHOLDER_ECR_URI/ticketing/ticketing:latest"
    orders               = "PLACEHOLDER_ECR_URI/ticketing/orders:latest"
    payments             = "PLACEHOLDER_ECR_URI/ticketing/payments:latest"
    fakepaymentgateway   = "PLACEHOLDER_ECR_URI/ticketing/fakepaymentgateway:latest"
    notification-service = "PLACEHOLDER_ECR_URI/ticketing/notification-service:latest"
  }
}

variable "tags" {
  type = map(string)
  default = {
    Project = "global-ticketing-platform"
  }
}
