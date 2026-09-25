variable "name_prefix" {
  type = string
}

variable "backend_urls" {
  description = <<-EOT
    Base URL for each of the 5 services this API Gateway replaces YARP for (DECISIONS.md D17).
    Locally these point at host.docker.internal:<port> (kubectl port-forward targets, see
    infrastructure/aws-local/port-forward-backends.sh); against real AWS the same module is
    applied with these pointed at the internal ALB/service-discovery addresses instead — no
    other change needed, which is the whole point of keeping this parameterized.
  EOT
  type = object({
    auth      = string
    catalog   = string
    ticketing = string
    orders    = string
    payments  = string
  })
}

variable "authorized_services" {
  description = <<-EOT
    Which of the 5 services require a valid JWT via the Lambda authorizer. "auth" is
    deliberately excluded by default — register/login must be reachable without a token, exactly
    like today (docs/CONTRACTS.md §1).
  EOT
  type        = set(string)
  default     = ["catalog", "ticketing", "orders", "payments"]
}

variable "jwt_secret" {
  description = "Must match auth-service's JWT_SECRET byte-for-byte (same rule as every other k8s secret.yaml that carries this value)."
  type        = string
  sensitive   = true
}

variable "allowed_origin" {
  description = "CORS origin allowed to call this API — the S3 static website endpoint hosting the frontend."
  type        = string
}

variable "stage_name" {
  type    = string
  default = "local"
}

variable "frontend_bucket_name" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
