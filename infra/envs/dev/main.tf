locals {
  labels = {
    app   = "aforo"
    env   = "dev"
    owner = "platform"
  }
}

# ---- Team access ---------------------------------------------------------------

# Read-only: teammates can inspect architecture, resources, logs and metrics, but cannot create,
# change, start or delete anything. Changes go through CI (code) and the project owner (Terraform).
locals {
  team_roles = ["roles/viewer", "roles/logging.viewer", "roles/monitoring.viewer"]
}

resource "google_project_iam_member" "team_readonly" {
  for_each = {
    for pair in setproduct(var.team_members, local.team_roles) :
    "${pair[0]}/${pair[1]}" => { member = pair[0], role = pair[1] }
  }

  project = var.project_id
  role    = each.value.role
  member  = "user:${each.value.member}"
}

# ---- Artifacts (D-19) ----------------------------------------------------------

# Images of the five services and web, tagged with the full git SHA. Immutable tags enforce
# "never re-tag": pushing an existing tag fails.
resource "google_artifact_registry_repository" "aforo" {
  repository_id = "aforo"
  location      = var.region
  format        = "DOCKER"
  description   = "Service and web images, tagged by git SHA"

  docker_config {
    immutable_tags = true
  }
}

# Source archives of the functions, <function>/<git-sha>.zip, never overwritten.
resource "google_storage_bucket" "functions" {
  name                        = "${var.project_id}-functions"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }
}
