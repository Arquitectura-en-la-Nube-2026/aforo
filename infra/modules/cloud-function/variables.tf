variable "name" {
  description = "Function name; deployed as aforo-<name> with runtime SA aforo-<name>-run."
  type        = string
}

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "entry_point" {
  type = string
}

variable "runtime" {
  type    = string
  default = "nodejs24"
}

variable "source_bucket" {
  description = "Bucket for source archives (placeholder here; CI uploads <name>/<sha>.zip)."
  type        = string
}

variable "build_service_account" {
  description = "Full resource name of the SA Cloud Build uses to build the function."
  type        = string
}

variable "timeout_seconds" {
  type = number
}

variable "max_instances" {
  type    = number
  default = 5
}

variable "concurrency" {
  type    = number
  default = 1
}

variable "memory" {
  type    = string
  default = "256M"
}

variable "env" {
  type    = map(string)
  default = {}
}

variable "secret_env" {
  description = "Env var name => Secret Manager secret id (latest version)."
  type        = map(string)
  default     = {}
}

variable "public" {
  type    = bool
  default = false
}

variable "invokers" {
  type    = list(string)
  default = []
}
