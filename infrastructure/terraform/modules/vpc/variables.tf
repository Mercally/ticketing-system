variable "name_prefix" {
  description = "Prefix applied to every resource name/tag created by this module."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "azs" {
  description = "Availability zones to spread public/private subnets across. Two is the minimum for RDS's requirement of a multi-AZ DB subnet group."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  description = "One CIDR per AZ, for public subnets (NAT gateways, internet-facing ALB if any)."
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "One CIDR per AZ, for private subnets (ECS tasks, RDS instances — nothing here has a public IP)."
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "single_nat_gateway" {
  description = "true = one NAT gateway shared across AZs (cheaper, single point of failure — fine for a PoC target); false = one per AZ (production-grade, costs more)."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Common tags merged into every resource this module creates."
  type        = map(string)
  default     = {}
}
