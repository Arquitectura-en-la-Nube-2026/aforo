# Delayed-delivery queues (contracts/events/README.md). Tasks carry an OIDC token of
# aforo-tasks-invoker; the producer needs enqueuer on its queue and actAs on that SA.

resource "google_service_account" "tasks_invoker" {
  account_id   = "aforo-tasks-invoker"
  display_name = "Signs Cloud Tasks requests"
}

resource "google_cloud_tasks_queue" "reservation_expiry" {
  name     = "reservation-expiry"
  location = var.region

  retry_config {
    max_attempts  = 5
    max_doublings = 3
  }
}

resource "google_cloud_tasks_queue" "payment_webhooks" {
  name     = "payment-webhooks"
  location = var.region

  retry_config {
    max_attempts = 5
  }
}

resource "google_cloud_tasks_queue" "prewarm_windows" {
  name     = "prewarm-windows"
  location = var.region

  retry_config {
    max_attempts = 5
  }
}

resource "google_cloud_tasks_queue_iam_member" "inventory_enqueuer" {
  name     = google_cloud_tasks_queue.reservation_expiry.name
  location = var.region
  role     = "roles/cloudtasks.enqueuer"
  member   = module.inventory.service_account_member
}

resource "google_service_account_iam_member" "inventory_acts_as_tasks_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = module.inventory.service_account_member
}
