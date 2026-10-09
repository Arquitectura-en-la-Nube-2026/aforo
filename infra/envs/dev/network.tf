# Permanent, free VPC for Memorystore (ADR-0001). queue and gateway (quota counters) reach it
# through Direct VPC egress.

resource "google_compute_network" "aforo" {
  name                    = "aforo-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "aforo" {
  name                     = "aforo-${var.region}"
  network                  = google_compute_network.aforo.id
  region                   = var.region
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

module "memorystore" {
  source = "../../modules/memorystore"

  enabled    = var.redis_enabled
  region     = var.region
  network_id = google_compute_network.aforo.id
}
