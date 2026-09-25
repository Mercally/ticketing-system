# API Gateway REPLACING YARP for the k8s path (DECISIONS.md D17) — 5 direct HTTP_PROXY
# integrations (no ALB/VPC Link, unlike modules/ecs's API Gateway v2, which is a materially
# different shape for the real-AWS-with-private-VPC target and is intentionally left untouched).
# This module is meant to be applied twice with different backend_urls: once against LocalStack
# (host.docker.internal:<port-forwarded-port>) for local hands-on validation, once against real
# AWS later (internal ALB/service-discovery addresses) — same module, same resource shape, only
# the input URLs change.
#
# REST API (v1), not HTTP API (v2): needed for aws_api_gateway_authorizer (TOKEN type), which is
# simpler and better-supported than HTTP API's JWT/Lambda authorizer for a from-scratch Lambda
# authorizer exercise.

resource "aws_api_gateway_rest_api" "this" {
  name = "${var.name_prefix}-api"
  tags = var.tags
}

locals {
  services = {
    auth      = var.backend_urls.auth
    catalog   = var.backend_urls.catalog
    ticketing = var.backend_urls.ticketing
    orders    = var.backend_urls.orders
    payments  = var.backend_urls.payments
  }
  authorized_services = tolist(var.authorized_services)
}

resource "aws_api_gateway_resource" "api" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "api"
}

# One resource per service (auth/catalog/ticketing/orders/payments), matching
# docs/CONTRACTS.md §1's /api/<service>/* prefixes exactly — same shape the frontend's
# apiClient.ts already calls, so it needs zero changes to work through this Gateway instead of
# YARP.
resource "aws_api_gateway_resource" "service" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = each.key
}

resource "aws_api_gateway_resource" "proxy" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.service[each.key].id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  for_each = local.services

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.proxy[each.key].id
  http_method   = "ANY"
  authorization = contains(local.authorized_services, each.key) ? "CUSTOM" : "NONE"
  authorizer_id = contains(local.authorized_services, each.key) ? aws_api_gateway_authorizer.jwt.id : null

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "proxy" {
  for_each = local.services

  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.proxy[each.key].id
  http_method             = aws_api_gateway_method.proxy[each.key].http_method
  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "${each.value}/{proxy}"

  request_parameters = {
    "integration.request.path.proxy" = "method.request.path.proxy"
  }
}

# CORS preflight (OPTIONS) — HTTP_PROXY integrations pass the backend's response straight through
# with no way to inject headers, so OPTIONS gets its own MOCK integration that answers the
# preflight directly. The actual (non-OPTIONS) responses get their Access-Control-Allow-Origin
# header from the backend services themselves now (they gained their own CORS middleware as part
# of this change, matching ALLOWED_ORIGIN — see DECISIONS.md D17), not from API Gateway, since
# HTTP_PROXY can't add response headers to a passthrough integration.
resource "aws_api_gateway_method" "proxy_options" {
  for_each = local.services

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.proxy[each.key].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "proxy_options" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.proxy[each.key].id
  http_method = aws_api_gateway_method.proxy_options[each.key].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "proxy_options" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.proxy[each.key].id
  http_method = aws_api_gateway_method.proxy_options[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "proxy_options" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.proxy[each.key].id
  http_method = aws_api_gateway_method.proxy_options[each.key].http_method
  status_code = aws_api_gateway_method_response.proxy_options[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type,Idempotency-Key,X-Correlation-Id'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.allowed_origin}'"
  }

  depends_on = [aws_api_gateway_integration.proxy_options]
}

# Exact-path methods (e.g. POST /api/orders, no trailing segment) — separate from the {proxy+}
# resources above. A {proxy+} greedy path variable only matches when at least one more path
# segment follows it; a bare /api/orders never reaches /api/orders/{proxy+}, it needs its own
# method on /api/orders itself. This bit exactly ONE real route in practice — Orders'
# `POST /orders` (OrdersController's root [Route("")]), the only one of the 5 services' HTTP
# surfaces with a zero-segment endpoint — but every service gets the same treatment for
# correctness, not just orders.
resource "aws_api_gateway_method" "exact" {
  for_each = local.services

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.service[each.key].id
  http_method   = "ANY"
  authorization = contains(local.authorized_services, each.key) ? "CUSTOM" : "NONE"
  authorizer_id = contains(local.authorized_services, each.key) ? aws_api_gateway_authorizer.jwt.id : null
}

resource "aws_api_gateway_integration" "exact" {
  for_each = local.services

  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.service[each.key].id
  http_method             = aws_api_gateway_method.exact[each.key].http_method
  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = each.value
}

resource "aws_api_gateway_method" "exact_options" {
  for_each = local.services

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.service[each.key].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "exact_options" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.service[each.key].id
  http_method = aws_api_gateway_method.exact_options[each.key].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "exact_options" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.service[each.key].id
  http_method = aws_api_gateway_method.exact_options[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "exact_options" {
  for_each = local.services

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.service[each.key].id
  http_method = aws_api_gateway_method.exact_options[each.key].http_method
  status_code = aws_api_gateway_method_response.exact_options[each.key].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Authorization,Content-Type,Idempotency-Key,X-Correlation-Id'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.allowed_origin}'"
  }

  depends_on = [aws_api_gateway_integration.exact_options]
}

# --- Lambda JWT authorizer (NEW enforcement — see variables.tf's authorized_services comment) ---

data "archive_file" "authorizer" {
  type        = "zip"
  source_dir  = "${path.module}/../../../aws-local/lambda/authorizer"
  output_path = "${path.module}/../../../aws-local/lambda/authorizer.zip"
  excludes    = ["package-lock.json"]
}

resource "aws_iam_role" "authorizer" {
  name = "${var.name_prefix}-authorizer-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "authorizer_logs" {
  role       = aws_iam_role.authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "authorizer" {
  function_name    = "${var.name_prefix}-jwt-authorizer"
  role             = aws_iam_role.authorizer.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.authorizer.output_path
  source_code_hash = data.archive_file.authorizer.output_base64sha256
  timeout          = 5

  environment {
    variables = {
      JWT_SECRET = var.jwt_secret
    }
  }

  tags = var.tags
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*"
}

resource "aws_api_gateway_authorizer" "jwt" {
  name                             = "${var.name_prefix}-jwt-authorizer"
  rest_api_id                      = aws_api_gateway_rest_api.this.id
  authorizer_uri                   = aws_lambda_function.authorizer.invoke_arn
  type                             = "REQUEST"
  identity_source                  = "method.request.header.Authorization"
  authorizer_result_ttl_in_seconds = 0
}

# --- Deployment ---

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.proxy,
      aws_api_gateway_method.proxy,
      aws_api_gateway_integration.proxy,
      aws_api_gateway_method.proxy_options,
      aws_api_gateway_integration.proxy_options,
      aws_api_gateway_method.exact,
      aws_api_gateway_integration.exact,
      aws_api_gateway_method.exact_options,
      aws_api_gateway_integration.exact_options,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.proxy,
    aws_api_gateway_integration_response.proxy_options,
    aws_api_gateway_integration.exact,
    aws_api_gateway_integration_response.exact_options,
  ]
}

resource "aws_api_gateway_stage" "this" {
  deployment_id = aws_api_gateway_deployment.this.id
  rest_api_id   = aws_api_gateway_rest_api.this.id
  stage_name    = var.stage_name
  tags          = var.tags
}

# --- Frontend static hosting (S3, no CloudFront in v1 — modules/cloudfront_waf already exists
# for whenever this gets applied against real AWS) ---

resource "aws_s3_bucket" "frontend" {
  bucket = var.frontend_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html" # SPA fallback, same reasoning as infrastructure/docker/frontend-nginx.conf
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
