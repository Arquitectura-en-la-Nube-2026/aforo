# ---- Runtime switches, read back by the Makefile before every apply (ADR-0004) ----

output "switch_env_on" {
  value = var.env_on
}

output "switch_redis_enabled" {
  value = var.redis_enabled
}

output "switch_mock_fault_mode" {
  value = var.mock_fault_mode
}

# ---- Values CI needs ------------------------------------------------------------

output "artifact_registry" {
  description = "Docker repository prefix for images: <this>/<unit>:<git-sha>."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.aforo.repository_id}"
}

output "functions_bucket" {
  description = "Bucket for function source archives."
  value       = google_storage_bucket.functions.name
}
