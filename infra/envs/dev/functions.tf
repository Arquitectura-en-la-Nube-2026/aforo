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

# ---- prewarmer (E-01, D-21) ------------------------------------------------------
# Owns the service-level minimum instances of gateway and queue (ignored by Terraform there).

locals {
  # Deterministic URL: the function can't reference its own uri. Also the OIDC audience of the
  # pushes and tasks it receives (functions have no custom audiences).
  prewarmer_url = "https://aforo-prewarmer-${data.google_project.this.number}.${var.region}.run.app"

  prewarmer_targets = {
    gateway = module.gateway
    queue   = module.queue
  }
}

module "prewarmer" {
  source = "../../modules/cloud-function"

  name                  = "prewarmer"
  project_id            = var.project_id
  region                = var.region
  entry_point           = "prewarmer"
  source_bucket         = google_storage_bucket.functions.name
  build_service_account = google_service_account.functions_build.id
  timeout_seconds       = 30
  max_instances         = 1 # with concurrency 1, warm and cool never race
  concurrency           = 1
  invokers = [
    google_service_account.pubsub_push.member,
    google_service_account.tasks_invoker.member,
  ]

  env = {
    LOG_LEVEL                     = "info"
    GCP_PROJECT_ID                = var.project_id
    GCP_REGION                    = var.region
    TASKS_QUEUE                   = google_cloud_tasks_queue.prewarm_windows.name
    SELF_URL                      = local.prewarmer_url
    TASKS_INVOKER_SERVICE_ACCOUNT = google_service_account.tasks_invoker.email
    TARGET_SERVICES               = "${module.gateway.name}:1,${module.queue.name}:1"
    BASELINE_MIN_INSTANCES        = "0"
    PREWARM_LEAD_SECONDS          = "600"
    PREWARM_HOLD_SECONDS          = "3600"
  }

  depends_on = [google_project_iam_member.functions_build]
}

# Update only gateway and queue (run.developer on those services, actAs on their runtime SAs).
resource "google_cloud_run_v2_service_iam_member" "prewarmer_developer" {
  for_each = local.prewarmer_targets

  name     = each.value.name
  location = var.region
  role     = "roles/run.developer"
  member   = module.prewarmer.service_account_member
}

resource "google_service_account_iam_member" "prewarmer_acts_as_target" {
  for_each = local.prewarmer_targets

  service_account_id = "projects/${var.project_id}/serviceAccounts/${each.value.service_account_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = module.prewarmer.service_account_member
}

# Enqueue and list on prewarm-windows (the queue is its state), signing tasks as the invoker.
resource "google_cloud_tasks_queue_iam_member" "prewarmer" {
  for_each = toset(["roles/cloudtasks.enqueuer", "roles/cloudtasks.viewer"])

  name     = google_cloud_tasks_queue.prewarm_windows.name
  location = var.region
  role     = each.value
  member   = module.prewarmer.service_account_member
}

resource "google_service_account_iam_member" "prewarmer_acts_as_tasks_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = module.prewarmer.service_account_member
}
