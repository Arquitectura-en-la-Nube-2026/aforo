# The five services and web (infra/README.md: sizing from ADR-0005, wiring from ADR-0004).
# Env vars that need resources not declared yet (functions) are added together with them.

data "google_project" "this" {}

locals {
  # Deterministic Cloud Run URL, for a service that needs its own URL or where references would
  # form a cycle (web <-> gateway).
  run_url = {
    for name in ["web", "inventory"] :
    name => "https://aforo-${name}-${data.google_project.this.number}.${var.region}.run.app"
  }

  common_env = {
    LOG_LEVEL      = "info"
    GCP_PROJECT_ID = var.project_id
    AUTH_MODE      = "cloud"
  }
}

module "web" {
  source = "../../modules/cloud-run-service"

  name           = "web"
  project_id     = var.project_id
  region         = var.region
  container_port = 4000
  max_instances  = 2
  public         = true

  env = {
    API_BASE_URL     = module.gateway.uri
    SSR_API_BASE_URL = module.gateway.uri
  }
}

module "gateway" {
  source = "../../modules/cloud-run-service"

  name          = "gateway"
  project_id    = var.project_id
  region        = var.region
  max_instances = 3
  public        = true

  secret_env = {
    AUTH_SECRET = google_secret_manager_secret.auth.secret_id
  }

  env = merge(local.common_env, {
    AUTH_ISSUER                = "https://gateway.aforo.dev"
    TOKEN_TTL_HOURS            = "8"
    FRONTEND_ORIGIN            = local.run_url.web
    CATALOG_URL                = module.catalog.uri
    QUEUE_URL                  = module.queue.uri
    ORDERS_URL                 = module.orders.uri
    INVENTORY_URL              = module.inventory.uri
    RATE_LIMIT_QUEUE_PER_MIN   = "60"
    RATE_LIMIT_DEFAULT_PER_MIN = "600"
  })
}

module "catalog" {
  source = "../../modules/cloud-run-service"

  name          = "catalog"
  project_id    = var.project_id
  region        = var.region
  max_instances = 2
  invokers = [
    module.gateway.service_account_member,
    google_service_account.scheduler.member,
  ]

  cloud_sql_instance = module.cloud_sql.connection_name
  secret_env = {
    DATABASE_URL = module.cloud_sql.database_url_secret_ids["catalog"]
  }

  env = merge(local.common_env, {
    DB_POOL_MAX                  = "2"
    TOPIC_EVENT_PUBLISHED        = "aforo.catalog.event-published"
    TOPIC_SALES_RULES_CONFIGURED = "aforo.catalog.sales-rules-configured"
  })
}

module "queue" {
  source = "../../modules/cloud-run-service"

  name                    = "queue"
  project_id              = var.project_id
  region                  = var.region
  max_instances           = 2
  concurrency             = 250
  cpu_always_allocated    = true
  request_timeout_seconds = 3600
  invokers = [
    module.gateway.service_account_member,
    google_service_account.pubsub_push.member,
  ]

  vpc_egress = {
    network    = google_compute_network.aforo.id
    subnetwork = google_compute_subnetwork.aforo.id
  }

  env = merge(local.common_env, {
    REDIS_URL                  = module.memorystore.url
    ADMISSION_BATCH_SIZE       = "500"
    ADMISSION_INTERVAL_SECONDS = "5"
    PASS_TTL_SECONDS           = "600"
    SSE_HEARTBEAT_SECONDS      = "15"
  })
}

module "orders" {
  source = "../../modules/cloud-run-service"

  name          = "orders"
  project_id    = var.project_id
  region        = var.region
  max_instances = 1 # single circuit breaker (ADR-0005)
  invokers = [
    module.gateway.service_account_member,
    google_service_account.pubsub_push.member,
    google_service_account.scheduler.member,
  ]

  cloud_sql_instance = module.cloud_sql.connection_name
  secret_env = {
    DATABASE_URL   = module.cloud_sql.database_url_secret_ids["orders"]
    WEBHOOK_SECRET = google_secret_manager_secret.webhook.secret_id
  }

  env = merge(local.common_env, {
    DB_POOL_MAX              = "3"
    INVENTORY_URL            = module.inventory.uri
    TOPIC_ORDER_PAID         = "aforo.orders.order-paid"
    FRONTEND_ORIGIN          = local.run_url.web
    HTTP_CONNECT_TIMEOUT_MS  = "500"
    HTTP_RESPONSE_TIMEOUT_MS = "2000"
    CB_FAILURE_THRESHOLD     = "5"
    CB_RESET_TIMEOUT_MS      = "30000"
    RETRY_MAX_ATTEMPTS       = "3"
    RETRY_BASE_DELAY_MS      = "200"
    RETRY_MAX_DELAY_MS       = "5000"
  })
}

module "inventory" {
  source = "../../modules/cloud-run-service"

  name          = "inventory"
  project_id    = var.project_id
  region        = var.region
  max_instances = 3
  invokers = [
    module.gateway.service_account_member,
    module.orders.service_account_member,
    google_service_account.pubsub_push.member,
    google_service_account.scheduler.member,
    google_service_account.tasks_invoker.member,
  ]

  cloud_sql_instance = module.cloud_sql.connection_name
  secret_env = {
    DATABASE_URL = module.cloud_sql.database_url_secret_ids["inventory"]
  }

  env = merge(local.common_env, {
    GCP_REGION                    = var.region
    DB_POOL_MAX                   = "2"
    TOPIC_RESERVATION_EXPIRED     = "aforo.inventory.reservation-expired"
    EXPIRY_SCHEDULER              = "cloud-tasks"
    TASKS_QUEUE                   = "reservation-expiry"
    SELF_URL                      = local.run_url.inventory
    TASKS_INVOKER_SERVICE_ACCOUNT = google_service_account.tasks_invoker.email
  })
}
