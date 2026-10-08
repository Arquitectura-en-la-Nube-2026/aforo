# Application secrets, generated once and kept in Secret Manager (never in tfvars or the repo).

# HS256 key for the simulated login (D-06).
resource "random_password" "auth" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "auth" {
  secret_id = "aforo-auth-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "auth" {
  secret      = google_secret_manager_secret.auth.id
  secret_data = random_password.auth.result
}

# HMAC key shared by orders and the mock payment gateway for the payment webhook.
resource "random_password" "webhook" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "webhook" {
  secret_id = "aforo-webhook-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "webhook" {
  secret      = google_secret_manager_secret.webhook.id
  secret_data = random_password.webhook.result
}
