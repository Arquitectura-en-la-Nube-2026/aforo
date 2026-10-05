output "name" {
  value = google_cloudfunctions2_function.this.name
}

output "uri" {
  value = google_cloudfunctions2_function.this.service_config[0].uri
}

output "service_account_member" {
  value = google_service_account.runtime.member
}
