# The five services and web (infra/README.md: sizing from ADR-0005, wiring from ADR-0004).
# Env vars that need resources not declared yet (Cloud SQL, secrets, Pub/Sub, Cloud Tasks,
# Memorystore, functions) are added together with those resources.

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
  region        = var.region
  max_instances = 3
  public        = true

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
  region        = var.region
  max_instances = 2
  invokers      = [module.gateway.service_account_member]

  env = merge(local.common_env, {
    DB_POOL_MAX                  = "2"
    TOPIC_EVENT_PUBLISHED        = "aforo.catalog.event-published"
    TOPIC_SALES_RULES_CONFIGURED = "aforo.catalog.sales-rules-configured"
  })
}

module "queue" {
  source = "../../modules/cloud-run-service"

  name                    = "queue"
  region                  = var.region
  max_instances           = 2
  concurrency             = 250
  cpu_always_allocated    = true
  request_timeout_seconds = 3600
  invokers                = [module.gateway.service_account_member]

  env = merge(local.common_env, {
    REDIS_URL                  = ""
    ADMISSION_BATCH_SIZE       = "500"
    ADMISSION_INTERVAL_SECONDS = "5"
    PASS_TTL_SECONDS           = "600"
    SSE_HEARTBEAT_SECONDS      = "15"
  })
}

module "orders" {
  source = "../../modules/cloud-run-service"

  name          = "orders"
  region        = var.region
  max_instances = 1 # single circuit breaker (ADR-0005)
  invokers      = [module.gateway.service_account_member]

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
  region        = var.region
  max_instances = 3
  invokers = [
    module.gateway.service_account_member,
    module.orders.service_account_member,
  ]

  env = merge(local.common_env, {
    GCP_REGION                = var.region
    DB_POOL_MAX               = "2"
    TOPIC_RESERVATION_EXPIRED = "aforo.inventory.reservation-expired"
    EXPIRY_SCHEDULER          = "cloud-tasks"
    TASKS_QUEUE               = "reservation-expiry"
    SELF_URL                  = local.run_url.inventory
  })
}
