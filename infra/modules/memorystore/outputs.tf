output "url" {
  description = "redis://<host>:<port>, or empty while the switch is off."
  value       = var.enabled ? "redis://${google_redis_instance.this[0].host}:${google_redis_instance.this[0].port}" : ""
}
