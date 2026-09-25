variable "jwt_secret" {
  description = "Must match auth-service's JWT_SECRET (infrastructure/k8s/base/auth-service/secret.yaml) byte-for-byte."
  type        = string
  default     = "local-dev-only-jwt-secret-change-me"
  sensitive   = true
}

variable "frontend_bucket_name" {
  type    = string
  default = "ticketing-frontend-local"
}

# Ports from infrastructure/aws-local/port-forward-backends.sh — kept as variables (not hardcoded
# in main.tf) so this file is the one place to look when re-pointing at different ports, and so
# the same shape of input can later point at real ALB/service-discovery addresses on AWS.
variable "backend_ports" {
  type = object({
    auth      = number
    catalog   = number
    ticketing = number
    orders    = number
    payments  = number
  })
  default = {
    auth      = 31001
    catalog   = 31002
    ticketing = 31003
    orders    = 31004
    payments  = 31005
  }
}
