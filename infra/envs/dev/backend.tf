# The state bucket is created once by hand during bootstrap (infra/README.md, Prerequisites),
# versioned so a corrupted state can be restored.
terraform {
  backend "gcs" {
    bucket = "aforo-dev-teamf-tfstate"
    prefix = "envs/dev"
  }
}
