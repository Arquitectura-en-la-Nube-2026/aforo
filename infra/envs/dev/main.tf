locals {
  labels = {
    app   = "aforo"
    env   = "dev"
    owner = "platform"
  }
}

# ---- Team access ---------------------------------------------------------------

resource "google_project_iam_member" "team_editor" {
  for_each = toset(var.team_members)

  project = var.project_id
  role    = "roles/editor"
  member  = "user:${each.value}"
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
