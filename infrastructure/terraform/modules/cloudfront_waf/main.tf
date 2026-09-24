# CloudFront + WAF module — the edge of ARCHITECTURE.md §10.5's "Massive Traffic" chain
# (CloudFront -> WAF -> Waiting Room/Admission Control -> API Gateway -> Services). Not applied —
# see modules/vpc/main.tf's header comment.
#
# Scope note: only the CloudFront distribution + WAFv2 Web ACL fronting API Gateway are modeled
# here, matching exactly what's drawn in the §10.5 diagram. Static frontend hosting (e.g. a
# separate S3 + CloudFront origin for the React SPA) is NOT in that diagram and isn't invented
# here — infrastructure/docker/frontend.Dockerfile's nginx container is this repo's only frontend
# hosting story today; adding S3+CloudFront for it would be a deliberate follow-up decision
# logged in DECISIONS.md, not something to slip in silently from this module.
#
# WAFv2 web ACLs that scope to CLOUDFRONT must be created in us-east-1, regardless of which region
# the rest of the stack lives in — this is an AWS requirement, not a choice made here. The root
# module is expected to pass an aws.us_east_1 provider alias into this module for that resource
# (see root main.tf's provider block + this module's versions.tf).

resource "aws_wafv2_web_acl" "this" {
  provider = aws.us_east_1

  name        = "${var.name_prefix}-waf"
  description = "Edge WAF in front of API Gateway — WAF-equivalent header/size checks + a rate-based backstop. Gateway (YARP) does the same job again, closer to the services, per DECISIONS.md D1; this is defense in depth, not a duplicate."
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-managed-common-rule-set"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common-rule-set"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  web_acl_id      = aws_wafv2_web_acl.this.arn
  comment         = "${var.name_prefix} edge — fronts API Gateway (ARCHITECTURE.md §10.5)"

  origin {
    domain_name = var.origin_domain_name
    origin_id   = "api-gateway"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "api-gateway"
    viewer_protocol_policy = "redirect-to-https"

    # Seat availability / order state is never cached as authoritative (ARCHITECTURE.md §9) — the
    # default behavior here forwards everything, including headers CloudFront would otherwise
    # strip (Authorization, Idempotency-Key, X-Correlation-Id — docs/CONTRACTS.md §2), and
    # disables caching by default. A follow-up could add a SEPARATE cache behavior for genuinely
    # cacheable read paths (e.g. /api/catalog/*), explicitly opted into — not done here to avoid
    # accidentally caching something that must always be re-validated server-side.
    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Idempotency-Key", "X-Correlation-Id", "traceparent"]

      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    # A real deployment would bring its own ACM cert (us-east-1) + custom domain here instead of
    # the CloudFront default certificate — left as the default for this unapplied skeleton.
  }

  tags = var.tags
}
