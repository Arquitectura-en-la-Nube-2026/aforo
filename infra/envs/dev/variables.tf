variable "project_id" {
  description = "GCP project that hosts the dev environment."
  type        = string
}

variable "region" {
  description = "Region for every regional resource."
  type        = string
  default     = "southamerica-east1"
}

variable "team_members" {
  description = "Google accounts of the team, granted roles/editor on the project."
  type        = list(string)
  default     = []
}

# ---- Runtime switches (ADR-0004) ---------------------------------------------
# Changed only through make up/down/redis-up/redis-down/fault, never by hand.

variable "env_on" {
  description = "Cloud SQL running and Cloud Scheduler jobs unpaused."
  type        = bool
  default     = false
}

variable "redis_enabled" {
  description = "Memorystore and the queue subscriptions exist (ADR-0001)."
  type        = bool
  default     = false
}

variable "mock_fault_mode" {
  description = "FAULT_MODE of mock-payment-gateway."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "error", "timeout"], var.mock_fault_mode)
    error_message = "mock_fault_mode must be none, error or timeout."
  }
}
