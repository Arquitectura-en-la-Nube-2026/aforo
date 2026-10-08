# One Cloud Run service with its own runtime service account (infra/README.md, ADR-0004).
# Terraform creates it with a placeholder image; CI owns the image and the traffic split.

resource "google_service_account" "runtime" {
  account_id   = "aforo-${var.name}-run"
  display_name = "Runtime of aforo-${var.name}"
}

# Each runtime SA reads only its own secrets.
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = toset(values(var.secret_env))

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}

resource "google_project_iam_member" "cloudsql_client" {
  count = var.cloud_sql_instance == "" ? 0 : 1

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = google_service_account.runtime.member
}

resource "google_cloud_run_v2_service" "this" {
  name                = "aforo-${var.name}"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  # Stable ID-token audience, accepted on every URL of the service including blue/green tag URLs
  # (the CI smoke test and service-to-service calls use it).
  custom_audiences = ["aforo-${var.name}"]

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

    dynamic "vpc_access" {
      for_each = var.vpc_egress == null ? [] : [var.vpc_egress]
      content {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = vpc_access.value.network
          subnetwork = vpc_access.value.subnetwork
        }
      }
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

      dynamic "volume_mounts" {
        for_each = var.cloud_sql_instance == "" ? [] : [1]
        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
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

    dynamic "volumes" {
      for_each = var.cloud_sql_instance == "" ? [] : [1]
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.cloud_sql_instance]
        }
      }
    }
  }

  # A revision can't start until it may read its secrets.
  depends_on = [google_secret_manager_secret_iam_member.runtime]

  lifecycle {
    # CI owns the image and traffic; the pre-warmer owns the service-level minimum (ADR-0004).
    # ignore_changes can't be conditional, so every service ignores the minimum; Terraform only
    # sets it at creation.
    # template[0].revision must NOT be ignored: CI deploys name the revision, and resending that
    # name with a new config fails (409). Setting it back to null lets Cloud Run name the next one,
    # so a plan after a CI deploy shows `revision = "aforo-x-000NN-abc" -> null`; that is expected.
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

# Migrations and the catalog seed (docs/architecture/build-and-deploy.md): the same image, identity
# and configuration as the service, so a job sees exactly what the service sees. CI sets the image
# on every deploy and runs the migrate job before the new revision gets traffic.
resource "google_cloud_run_v2_job" "this" {
  for_each = var.jobs

  name                = "aforo-${var.name}-${each.key}"
  location            = var.region
  deletion_protection = false

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.runtime.email
      max_retries     = 0
      timeout         = "300s"

      containers {
        # Placeholder until the first CI deploy of the service; it has no node, so running a job
        # before that fails loudly instead of pretending to work.
        image   = "us-docker.pkg.dev/cloudrun/container/job"
        command = ["node"]
        args    = each.value

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
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

        dynamic "volume_mounts" {
          for_each = var.cloud_sql_instance == "" ? [] : [1]
          content {
            name       = "cloudsql"
            mount_path = "/cloudsql"
          }
        }
      }

      dynamic "volumes" {
        for_each = var.cloud_sql_instance == "" ? [] : [1]
        content {
          name = "cloudsql"
          cloud_sql_instance {
            instances = [var.cloud_sql_instance]
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]

  lifecycle {
    # CI owns the image, as for the service (ADR-0004).
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}
