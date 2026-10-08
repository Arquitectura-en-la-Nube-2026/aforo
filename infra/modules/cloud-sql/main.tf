# One shared Postgres instance with a database and a user per service. Services reach it through
# the Cloud SQL connector socket mounted at /cloudsql (no authorized networks, no VPC peering).

resource "google_sql_database_instance" "this" {
  name                = "aforo-pg"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true

  settings {
    tier              = var.tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    activation_policy = var.env_on ? "ALWAYS" : "NEVER"
    disk_type         = "PD_HDD"
    disk_size         = 10
    disk_autoresize   = false

    # dev only: no backups (the catalog seed is idempotent, the rest is test data).
    backup_configuration {
      enabled = false
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    database_flags {
      name  = "max_connections"
      value = "25"
    }

    user_labels = {
      app   = "aforo"
      env   = "dev"
      owner = "platform"
    }
  }
}

resource "google_sql_database" "service" {
  for_each = toset(var.databases)

  name     = each.value
  instance = google_sql_database_instance.this.name
}

resource "random_password" "service" {
  for_each = toset(var.databases)

  length  = 32
  special = false
}

resource "google_sql_user" "service" {
  for_each = toset(var.databases)

  name     = each.value
  instance = google_sql_database_instance.this.name
  password = random_password.service[each.value].result
}

# DATABASE_URL per service, over the connector socket.
resource "google_secret_manager_secret" "database_url" {
  for_each = toset(var.databases)

  secret_id = "aforo-${each.value}-database-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  for_each = toset(var.databases)

  secret      = google_secret_manager_secret.database_url[each.value].id
  secret_data = "postgres://${each.value}:${random_password.service[each.value].result}@localhost/${each.value}?host=/cloudsql/${google_sql_database_instance.this.connection_name}"
}
