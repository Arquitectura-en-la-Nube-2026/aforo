# One business topic with a push subscription per consumer, each with its own DLQ topic
# (contracts/events/README.md, ADR-0005).

locals {
  pubsub_agent = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic" "this" {
  name = var.name
}

resource "google_pubsub_topic_iam_member" "publisher" {
  for_each = toset(var.publishers)

  topic  = google_pubsub_topic.this.name
  role   = "roles/pubsub.publisher"
  member = each.value
}

resource "google_pubsub_topic" "dlq" {
  for_each = var.subscriptions

  name = "${each.key}-dlq"
}

resource "google_pubsub_subscription" "push" {
  for_each = var.subscriptions

  name                 = each.key
  topic                = google_pubsub_topic.this.id
  ack_deadline_seconds = 60

  push_config {
    push_endpoint = each.value.endpoint

    oidc_token {
      service_account_email = var.push_service_account
      audience              = each.value.audience
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "60s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq[each.key].id
    max_delivery_attempts = 5
  }

  # Never expire for inactivity (the default deletes a subscription unused for 31 days).
  expiration_policy {
    ttl = ""
  }
}

# Dead-lettering needs the service agent to publish to the DLQ and to ack on the subscription.
resource "google_pubsub_topic_iam_member" "dlq_agent_publisher" {
  for_each = var.subscriptions

  topic  = google_pubsub_topic.dlq[each.key].name
  role   = "roles/pubsub.publisher"
  member = local.pubsub_agent
}

resource "google_pubsub_subscription_iam_member" "agent_subscriber" {
  for_each = var.subscriptions

  subscription = google_pubsub_subscription.push[each.key].name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}
