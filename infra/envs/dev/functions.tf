# Cloud Run functions (D-21). Built by a dedicated SA: new projects' default build SA has no
# build permissions.

resource "google_service_account" "functions_build" {
  account_id   = "aforo-functions-build"
  display_name = "Builds Cloud Run functions"
}

resource "google_project_iam_member" "functions_build" {
  for_each = toset([
    "roles/cloudbuild.builds.builder",
    "roles/logging.logWriter",
    "roles/artifactregistry.writer",
    "roles/storage.objectViewer",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.functions_build.member
}

# ---- dlq-monitor (E-05, D-17) ----------------------------------------------------

module "dlq_monitor" {
  source = "../../modules/cloud-function"

  name                  = "dlq-monitor"
  project_id            = var.project_id
  region                = var.region
  entry_point           = "dlqMonitor"
  source_bucket         = google_storage_bucket.functions.name
  build_service_account = google_service_account.functions_build.id
  timeout_seconds       = 10
  invokers              = [google_service_account.eventarc.member]

  env = {
    LOG_LEVEL      = "info"
    GCP_PROJECT_ID = var.project_id
  }

  depends_on = [google_project_iam_member.functions_build]
}

resource "google_service_account" "eventarc" {
  account_id   = "aforo-eventarc"
  display_name = "Delivers Eventarc events to functions"
}

locals {
  # Every DLQ topic (the queue-* ones only while Redis is on).
  dlq_topics = merge(
    module.topic_event_published.dlq_topics,
    module.topic_sales_rules_configured.dlq_topics,
    module.topic_reservation_expired.dlq_topics,
  )
}

resource "google_eventarc_trigger" "dlq_monitor" {
  for_each = local.dlq_topics

  name            = "aforo-dlq-${each.key}"
  location        = var.region
  service_account = google_service_account.eventarc.email

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }

  transport {
    pubsub {
      topic = "projects/${var.project_id}/topics/${each.value}"
    }
  }

  destination {
    cloud_run_service {
      service = module.dlq_monitor.name
      region  = var.region
    }
  }
}
