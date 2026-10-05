# POST /internal/v1/housekeeping every minute on each Postgres service (ADR-0002): outbox flush,
# expiry sweep. Paused while the environment is off.

resource "google_service_account" "scheduler" {
  account_id   = "aforo-scheduler"
  display_name = "Signs Cloud Scheduler housekeeping calls"
}

resource "google_cloud_scheduler_job" "housekeeping" {
  for_each = toset(["catalog", "orders", "inventory"])

  name      = "aforo-${each.value}-housekeeping"
  region    = var.region
  schedule  = "* * * * *"
  time_zone = "Etc/UTC"
  paused    = !var.env_on

  attempt_deadline = "60s"

  retry_config {
    retry_count = 0 # the next minute is the retry
  }

  http_target {
    http_method = "POST"
    uri         = "https://aforo-${each.value}-${data.google_project.this.number}.${var.region}.run.app/internal/v1/housekeeping"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = "aforo-${each.value}"
    }
  }
}
