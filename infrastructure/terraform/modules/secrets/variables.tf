variable "name_prefix" {
  type = string
}

variable "db_endpoints" {
  description = "Map of db key -> host:port, from modules/rds outputs.endpoints."
  type        = map(string)
}

variable "db_names" {
  type = map(string)
}

variable "db_usernames" {
  type = map(string)
}

variable "db_passwords" {
  description = "Map of db key -> generated master password, from modules/rds outputs.passwords. Sensitive."
  type        = map(string)
  sensitive   = true
}

variable "jwt_secret_length" {
  description = "Length of the generated JWT signing secret (HS256, per docs/CONTRACTS.md §3 — RS256+rotated keys is the noted production upgrade, not implemented here either, per ARCHITECTURE.md's own PoC-scope note)."
  type        = number
  default     = 64
}

variable "tags" {
  type    = map(string)
  default = {}
}
