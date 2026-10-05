# Queue store: Memorystore for Redis, Basic 1 GB, created only for live tests and demos
# (ADR-0001). No AUTH, no TLS: reachable only from aforo-vpc.

resource "google_redis_instance" "this" {
  count = var.enabled ? 1 : 0

  name               = "aforo-queue"
  region             = var.region
  tier               = "BASIC"
  memory_size_gb     = 1
  redis_version      = "REDIS_7_2"
  connect_mode       = "DIRECT_PEERING"
  authorized_network = var.network_id

  labels = {
    app   = "aforo"
    env   = "dev"
    owner = "platform"
  }
}
