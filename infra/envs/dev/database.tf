# Cloud SQL runs only while env_on = true (make up / make down); stopped, it bills disk only.

module "cloud_sql" {
  source = "../../modules/cloud-sql"

  project_id = var.project_id
  region     = var.region
  env_on     = var.env_on
  databases  = ["catalog", "orders", "inventory"]
}
