variable "name_prefix" {
  type = string
}

variable "origin_domain_name" {
  description = "Domain name of the API Gateway invoke URL (modules/ecs output api_gateway_invoke_url, with the scheme stripped) — CloudFront's origin, matching the CF -> WAF -> APIGW chain in ARCHITECTURE.md §10.5."
  type        = string
}

variable "rate_limit_per_5min" {
  description = "WAF rate-based rule threshold: requests per 5-minute window per client IP before that IP is blocked. This is the edge-layer backstop; Gateway's own ASP.NET Core rate limiting (ARCHITECTURE.md §9) is the finer-grained per-route/per-user control — the two are complementary, not redundant."
  type        = number
  default     = 2000
}

variable "tags" {
  type    = map(string)
  default = {}
}
