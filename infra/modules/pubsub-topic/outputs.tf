output "name" {
  value = google_pubsub_topic.this.name
}

output "dlq_topics" {
  description = "Subscription name => its DLQ topic name (dlq-monitor subscribes to these)."
  value       = { for k, t in google_pubsub_topic.dlq : k => t.name }
}
