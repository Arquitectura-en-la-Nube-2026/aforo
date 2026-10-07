# One Cloud Run function (2nd gen). Terraform creates it from a placeholder archive and owns its
# configuration; CI owns the source (ADR-0004).

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

# Placeholder answering 200 to any request under the real entry point, so triggers and probes
# work before the first CI deploy.
data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.placeholder-${var.name}.zip"

  source {
    filename = "index.js"
    content  = "require('@google-cloud/functions-framework').http('${var.entry_point}', (req, res) => res.status(200).send('placeholder'));\n"
  }

  source {
    filename = "package.json"
    content  = jsonencode({ name = "placeholder", main = "index.js", dependencies = { "@google-cloud/functions-framework" = "^5.0.0" } })
  }
}

resource "google_storage_bucket_object" "placeholder" {
  name   = "${var.name}/placeholder.zip"
  bucket = var.source_bucket
  source = data.archive_file.placeholder.output_path
}

resource "google_cloudfunctions2_function" "this" {
  name     = "aforo-${var.name}"
  location = var.region

  build_config {
    runtime         = var.runtime
    entry_point     = var.entry_point
    service_account = var.build_service_account

    source {
      storage_source {
        bucket = var.source_bucket
        object = google_storage_bucket_object.placeholder.name
      }
    }
  }

  service_config {
    service_account_email            = google_service_account.runtime.email
    min_instance_count               = 0
    max_instance_count               = var.max_instances
    max_instance_request_concurrency = var.concurrency
    available_memory                 = var.memory
    available_cpu                    = var.concurrency > 1 ? "1" : null
    timeout_seconds                  = var.timeout_seconds
    ingress_settings                 = "ALLOW_ALL"
    environment_variables            = var.env

    dynamic "secret_environment_variables" {
      for_each = var.secret_env
      content {
        key        = secret_environment_variables.key
        project_id = var.project_id
        secret     = secret_environment_variables.value
        version    = "latest"
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]

  lifecycle {
    # CI deploys gs://<bucket>/<name>/<sha>.zip; Terraform must not roll it back.
    ignore_changes = [build_config[0].source]
  }
}

resource "google_cloud_run_service_iam_member" "public" {
  count = var.public ? 1 : 0

  service  = google_cloudfunctions2_function.this.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "invoker" {
  for_each = toset(var.invokers)

  service  = google_cloudfunctions2_function.this.name
  location = var.region
  role     = "roles/run.invoker"
  member   = each.value
}
