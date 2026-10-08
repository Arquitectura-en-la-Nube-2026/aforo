# DLQ alert (E-05): any event=dead_letter line from dlq-monitor in a 60 s window opens an incident.

variable "alert_emails" {
  description = "Email addresses notified by alerts. Empty: incidents only show in the console."
  type        = list(string)
  default     = []
}

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_emails)

  display_name = "aforo alerts ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
}

resource "google_logging_metric" "dead_letters" {
  name   = "aforo/dead_letters"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"aforo-dlq-monitor\" AND jsonPayload.event=\"dead_letter\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "dead_letters" {
  display_name = "aforo: message dead-lettered"
  combiner     = "OR"

  conditions {
    display_name = "dead_letter count > 0 over 60 s"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.dead_letters.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_COUNT"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  documentation {
    content   = "A message reached a DLQ. Find it in Cloud Logging: jsonPayload.event=\"dead_letter\" on aforo-dlq-monitor; follow its correlationId. Runbook: docs/runbooks/demo.md (E-05)."
    mime_type = "text/markdown"
  }
}
