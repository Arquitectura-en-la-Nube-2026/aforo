variable "name" {
  description = "Unit name; the service is aforo-<name> and its runtime SA aforo-<name>-run."
  type        = string
}

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "max_instances" {
  description = "Per-revision cap (ADR-0005 connection budget)."
  type        = number
}

variable "concurrency" {
  type    = number
  default = 80
}

variable "cpu_always_allocated" {
  description = "Only queue: SSE and the admission timer need CPU between requests (ADR-0002)."
  type        = bool
  default     = false
}

variable "request_timeout_seconds" {
  type    = number
  default = 60
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "env" {
  description = "Plain environment variables. Secrets go through secret_env."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Env var name => Secret Manager secret id (latest version)."
  type        = map(string)
  default     = {}
}

variable "public" {
  description = "Allow unauthenticated invocation (only web and gateway)."
  type        = bool
  default     = false
}

variable "invokers" {
  description = "IAM members allowed to invoke a private service, e.g. serviceAccount:..."
  type        = list(string)
  default     = []
}

variable "cloud_sql_instance" {
  description = "Connection name to mount at /cloudsql, or empty for services without a database."
  type        = string
  default     = ""
}

variable "vpc_egress" {
  description = "Direct VPC egress (private ranges only) into this network/subnet, or null."
  type = object({
    network    = string
    subnetwork = string
  })
  default = null
}

variable "jobs" {
  description = "Cloud Run jobs aforo-<name>-<key> sharing this service's identity, env, secrets and Cloud SQL; each runs `node <args>` in the service image (CI sets it)."
  type        = map(list(string))
  default     = {}
}
