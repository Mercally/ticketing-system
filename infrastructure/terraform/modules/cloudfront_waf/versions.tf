# This module requires a second AWS provider configuration aliased "us_east_1", passed in from
# the root module, because WAFv2 web ACLs scoped to CLOUDFRONT must be created in us-east-1
# regardless of the stack's primary region (an AWS platform requirement, not a choice made here).
terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = ">= 5.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}
