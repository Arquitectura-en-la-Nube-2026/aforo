# One Cloud Run service with its own runtime service account (infra/README.md, ADR-0004).
# Terraform creates it with a placeholder image; CI owns the image and the traffic split.

resource "google_service_account" "runtime" {
  account_id   = "aforo-${var.name}-run"
  display_name = "Runtime of aforo-${var.name}"
}

resource "google_cloud_run_v2_service" "this" {
  name                = "aforo-${var.name}"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  # Created at 0. For gateway and queue the pre-warmer raises it during sales windows (D-21).
  scaling {
    min_instance_count = 0
  }

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = var.concurrency
    timeout                          = "${var.request_timeout_seconds}s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      # Placeholder until the first CI deploy; it answers 200 on any path, so the probes pass.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = var.container_port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle          = !var.cpu_always_allocated
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      # Never /health/ready: a service must boot with its DB or Redis off (ADR-0004).
      startup_probe {
        http_get {
          path = "/health/live"
        }
        period_seconds    = 3
        failure_threshold = 20
      }

      liveness_probe {
        http_get {
          path = "/health/live"
        }
        period_seconds = 30
      }
    }
  }

  lifecycle {
    # CI owns the image and traffic; the pre-warmer owns the service-level minimum (ADR-0004).
    # ignore_changes can't be conditional, so every service ignores the minimum; Terraform only
    # sets it at creation.
    ignore_changes = [
      template[0].containers[0].image,
      traffic,
      client,
      client_version,
      scaling[0].min_instance_count,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.public ? 1 : 0

  name     = google_cloud_run_v2_service.this.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = toset(var.invokers)

  name     = google_cloud_run_v2_service.this.name
  location = var.region
  role     = "roles/run.invoker"
  member   = each.value
}
