# Built from inputs, not read from the instance, so callers can use it in count/for_each at plan
# time. Same value as google_sql_database_instance.this.connection_name.
output "connection_name" {
  value = "${var.project_id}:${var.region}:${google_sql_database_instance.this.name}"
}

output "database_url_secret_ids" {
  description = "Service => Secret Manager secret id holding its DATABASE_URL."
  value       = { for name, s in google_secret_manager_secret.database_url : name => s.secret_id }
}
