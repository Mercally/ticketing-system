output "rest_api_id" {
  value = aws_api_gateway_rest_api.this.id
}

output "invoke_url" {
  description = <<-EOT
    LocalStack's execute-api convenience domain — a real public DNS name
    (*.execute-api.localhost.localstack.cloud) that resolves to 127.0.0.1, so this works with no
    /etc/hosts editing and looks like a real AWS invoke URL. Against real AWS this same value
    would come from aws_api_gateway_stage.this.invoke_url instead.
  EOT
  value       = "http://${aws_api_gateway_rest_api.this.id}.execute-api.localhost.localstack.cloud:4566/${var.stage_name}"
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "frontend_website_endpoint" {
  description = "LocalStack S3 website convenience domain — resolves to 127.0.0.1 the same way as invoke_url."
  value       = "http://${var.frontend_bucket_name}.s3-website.localhost.localstack.cloud:4566"
}
