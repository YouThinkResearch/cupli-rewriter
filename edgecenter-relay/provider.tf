terraform {
  required_version = ">= 0.13.0"

  # Remote state backend – Google Cloud Storage
  backend "s3" {
    bucket = "terraform-rewriter-state"
    key    = "relay/terraform.tfstate"
    region = "auto"

    # R2 S3-compatible settings
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true

    endpoint = "https://5cbd25b113ce377352027b6e84867d15.r2.cloudflarestorage.com"
  }
  # backend "gcs" {
  #   # TODO: change this to an existing bucket in your GCP project
  #   bucket = "hetzner-metal-k8s-terraform-state"

  #   # Each root module keeps its state under a distinct prefix
  #   prefix = "edgecenter-relay"
  # }

  required_providers {
    edgecenter = {
      source  = "Edge-Center/edgecenter"
      version = "0.8.5" # pin provider version
    }
    acme = {
      source  = "vancluever/acme"
      version = "~> 2.9"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}


provider "edgecenter" {
  edgecenter_platform_api = "https://api.edgecenter.ru/iam"
  edgecenter_cloud_api    = "https://api.edgecenter.ru/cloud"
  permanent_api_token     = var.edgecenter_api_token
}

provider "acme" {
  server_url = "https://acme-v02.api.letsencrypt.org/directory"
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
