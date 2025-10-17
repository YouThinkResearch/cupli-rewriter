terraform {
  required_version = ">= 0.13.0"

  # Remote state backend – Google Cloud Storage
  backend "s3" {
    bucket = "terraform-rewriter-state"
    key    = "relay-prosto/terraform.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true

    endpoints = { s3 = "https://ce0c2881f5d5e766cf80d99473b5f220.r2.cloudflarestorage.com" }
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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
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
