# Topics, push subscriptions and DLQs from contracts/events/README.md. Every push targets
# POST /internal/v1/events/<subscription> on its consumer with an OIDC token of aforo-pubsub-push.
# OUT-OF-SCOPE here: prewarmer-event-published is added with the prewarmer function.

resource "google_service_account" "pubsub_push" {
  account_id   = "aforo-pubsub-push"
  display_name = "Signs Pub/Sub push requests"
}

locals {
  push = {
    for consumer in ["queue", "inventory", "orders"] :
    consumer => {
      base     = "https://aforo-${consumer}-${data.google_project.this.number}.${var.region}.run.app/internal/v1/events"
      audience = "aforo-${consumer}"
    }
  }

  # The queue's subscriptions exist only while Memorystore is on (ADR-0001).
  queue_subscriptions = var.redis_enabled ? ["queue"] : []
}

module "topic_event_published" {
  source = "../../modules/pubsub-topic"

  name                 = "aforo.catalog.event-published"
  project_number       = data.google_project.this.number
  publishers           = [module.catalog.service_account_member]
  push_service_account = google_service_account.pubsub_push.email

  subscriptions = merge(
    {
      inventory-event-published = {
        endpoint = "${local.push.inventory.base}/inventory-event-published"
        audience = local.push.inventory.audience
      }
    },
    {
      for c in local.queue_subscriptions : "queue-event-published" => {
        endpoint = "${local.push.queue.base}/queue-event-published"
        audience = local.push.queue.audience
      }
    },
  )
}

module "topic_sales_rules_configured" {
  source = "../../modules/pubsub-topic"

  name                 = "aforo.catalog.sales-rules-configured"
  project_number       = data.google_project.this.number
  publishers           = [module.catalog.service_account_member]
  push_service_account = google_service_account.pubsub_push.email

  subscriptions = merge(
    {
      inventory-sales-rules = {
        endpoint = "${local.push.inventory.base}/inventory-sales-rules"
        audience = local.push.inventory.audience
      }
    },
    {
      for c in local.queue_subscriptions : "queue-sales-rules" => {
        endpoint = "${local.push.queue.base}/queue-sales-rules"
        audience = local.push.queue.audience
      }
    },
  )
}

module "topic_reservation_expired" {
  source = "../../modules/pubsub-topic"

  name                 = "aforo.inventory.reservation-expired"
  project_number       = data.google_project.this.number
  publishers           = [module.inventory.service_account_member]
  push_service_account = google_service_account.pubsub_push.email

  subscriptions = {
    orders-reservation-expired = {
      endpoint = "${local.push.orders.base}/orders-reservation-expired"
      audience = local.push.orders.audience
    }
  }
}

# Published but not consumed in this slice; created so Orders doesn't change later.
module "topic_order_paid" {
  source = "../../modules/pubsub-topic"

  name                 = "aforo.orders.order-paid"
  project_number       = data.google_project.this.number
  publishers           = [module.orders.service_account_member]
  push_service_account = google_service_account.pubsub_push.email
}
