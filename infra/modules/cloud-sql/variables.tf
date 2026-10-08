variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env_on" {
  description = "Runtime switch: ALWAYS when true, NEVER (stopped, disk only) when false (ADR-0004)."
  type        = bool
}

variable "tier" {
  type    = string
  default = "db-f1-micro"
}

variable "databases" {
  description = "One database and one user with the same name per service (Database per Service)."
  type        = list(string)
}
