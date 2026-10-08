output "name" {
  value = google_cloud_run_v2_service.this.name
}

output "uri" {
  value = google_cloud_run_v2_service.this.uri
}

output "service_account_email" {
  value = google_service_account.runtime.email
}

output "service_account_member" {
  value = google_service_account.runtime.member
}

output "job_names" {
  value = { for key, job in google_cloud_run_v2_job.this : key => job.name }
}
