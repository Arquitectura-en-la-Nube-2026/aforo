variable "enabled" {
  description = "Runtime switch redis_enabled: the instance exists only while true (ADR-0001)."
  type        = bool
}

variable "region" {
  type = string
}

variable "network_id" {
  description = "VPC the instance peers with (DIRECT_PEERING, private IP only)."
  type        = string
}
