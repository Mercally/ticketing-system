# Plain-Terraform provider override pointed at LocalStack — the exact recipe already documented
# in infrastructure/LOCAL_AWS_SIMULATION.md §6, just actually committed and applied this time
# (that doc's version was explicitly "never run, treat as a starting point"). Functionally
# equivalent to the `tflocal` wrapper the plan called for; using it directly here because
# `tflocal` (the `terraform-local` PyPI package) couldn't be installed in this environment.
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true # LocalStack's S3 needs path-style addressing, not virtual-hosted-style

  endpoints {
    apigateway = "http://localhost:4566"
    lambda     = "http://localhost:4566"
    s3         = "http://localhost:4566"
    iam        = "http://localhost:4566"
    sts        = "http://localhost:4566"
  }
}
