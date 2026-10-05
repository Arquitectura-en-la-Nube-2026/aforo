variable "name" {
  description = "Topic name, aforo.<producer>.<fact>."
  type        = string
}

variable "project_number" {
  description = "Used to name the Pub/Sub service agent."
  type        = string
}

variable "publishers" {
  description = "IAM members allowed to publish (the producer's runtime SA)."
  type        = list(string)
  default     = []
}

variable "push_service_account" {
  description = "Email of the SA whose OIDC token signs every push."
  type        = string
}

variable "subscriptions" {
  description = "Subscription name => push endpoint and OIDC audience of the consumer."
  type = map(object({
    endpoint = string
    audience = string
  }))
  default = {}
}
