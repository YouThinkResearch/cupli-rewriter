# u-survey.ru: EdgeCenter CDN (Russian edge) -> rewriter on hub-production (k8s/rewriter.yaml).
#
# Replaces the Yandex relay after the ru-central1-a datacenter loss on 2026-10-11, and
# the older Railway origin. Same EdgeCenter module as edgecenter-relay-prosto, minus
# Railway: the origin is the rewriter's NodePort on a hub-production node.

terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "terraform-rewriter-state"
    key    = "relay-edgecenter-hub/terraform.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true

    endpoints = { s3 = "https://ce0c2881f5d5e766cf80d99473b5f220.r2.cloudflarestorage.com" }
  }

  required_providers {
    edgecenter = {
      source  = "Edge-Center/edgecenter"
      version = "0.17.1"
    }
    acme = {
      source  = "vancluever/acme"
      version = "~> 2.9"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "edgecenter_api_token" {
  type      = string
  sensitive = true
}

# Global API key of the Cupli Cloudflare account (owns u-survey.ru).
variable "cloudflare_api_key" {
  type      = string
  sensitive = true
}

variable "cloudflare_email" {
  type = string
}

variable "relay_secret_key" {
  description = "Sent by the CDN as x-relay-secret-key; the bun handler ignores it"
  type        = string
  default     = "unused"
  sensitive   = true
}

variable "zone_id" {
  type    = string
  default = "4d53c16d3b43cb1b5e8c54ec8e4bcc54" # u-survey.ru
}

variable "proxy_host" {
  type    = string
  default = "u-survey.ru"
}

variable "aliases" {
  type    = list(string)
  default = ["survey", "gzmo", "gzmos3", "gzmocfr"]
}

# ponytail: single node as origin. NodePort answers on every node, so if this node dies
# switch origin_ip to 135.181.180.212 or 65.109.59.226 and apply.
variable "origin_ip" {
  description = "a hub-production node; the rewriter NodePort answers on all of them"
  type        = string
  default     = "65.109.54.88"
}

variable "origin_port" {
  type    = number
  default = 30380
}

provider "edgecenter" {
  edgecenter_platform_api = "https://api.edgecenter.ru/iam"
  edgecenter_cloud_api    = "https://api.edgecenter.ru/cloud"
  permanent_api_token     = var.edgecenter_api_token
}

provider "cloudflare" {
  api_key = var.cloudflare_api_key
  email   = var.cloudflare_email
}

provider "acme" {
  server_url = "https://acme-v02.api.letsencrypt.org/directory"
}

locals {
  hosts = [for a in var.aliases : "${a}.${var.proxy_host}"]
  # EdgeCenter rejects an IP here: the module uses the origin host for the Host
  # header and SNI, and the API requires "a valid domain name".
  origin_host = "hub-origin.${var.proxy_host}"
}

resource "cloudflare_dns_record" "origin" {
  zone_id = var.zone_id
  name    = local.origin_host
  type    = "A"
  content = var.origin_ip
  ttl     = 300
  proxied = false
}

data "http" "edgecenter_client" {
  url             = "https://api.edgecenter.ru/cdn/clients/me"
  request_headers = { Authorization = "APIKey ${var.edgecenter_api_token}" }
}

locals {
  edgecdn_cname = jsondecode(data.http.edgecenter_client.response_body).cname
}

# --- certificate (DNS-01 via Cloudflare), uploaded to EdgeCenter -------------------
resource "acme_registration" "reg" {
  email_address = "s.orlov@cup.li"
}

resource "acme_certificate" "le" {
  account_key_pem           = acme_registration.reg.account_key_pem
  common_name               = "*.${var.proxy_host}"
  subject_alternative_names = [var.proxy_host]

  dns_challenge {
    provider = "cloudflare"
    config = {
      CF_API_EMAIL = var.cloudflare_email
      CF_API_KEY   = var.cloudflare_api_key
    }
  }
}

resource "random_id" "cert_suffix" {
  byte_length = 4
  keepers     = { pem = sha256(acme_certificate.le.certificate_pem) }
}

resource "edgecenter_cdn_sslcert" "le" {
  name        = "*.${var.proxy_host}-hub-${random_id.cert_suffix.hex}"
  cert        = "${acme_certificate.le.certificate_pem}${acme_certificate.le.issuer_pem}"
  private_key = acme_certificate.le.private_key_pem

  lifecycle {
    create_before_destroy = true
  }
}

# --- CDN ----------------------------------------------------------------------------
module "cdn" {
  source = "../edgecenter-relay-prosto/modules/edgecenter-cdn"

  cname             = local.hosts
  origin_source     = "${local.origin_host}:${var.origin_port}"
  origin_protocol   = "HTTP"
  origin_group_name = "u-survey hub-production"
  relay_secret_key  = var.relay_secret_key
  description       = "u-survey.ru -> hub-production rewriter"
  ssl_cert_id       = edgecenter_cdn_sslcert.le.id
  ssl_enabled       = true
  ssl_automated     = false

  depends_on = [cloudflare_dns_record.origin]

  cached_rules = [{
    name           = "Static content"
    rule           = "^/.*\\.(js|mjs|css|bmp|jpg|jpeg|gif|png|svg|ico|ttf|ttc|otf|eot|woff|woff2|webp|mp3|mp4)$"
    weight         = 1
    cache_duration = "345600s"
  }]
}

# --- DNS ----------------------------------------------------------------------------
# The four u-survey.ru names moved to selectel-relay/ on 2026-10-12 and point straight
# at the Selectel VM - no CDN in front. This CDN resource is left in place only as a
# rollback: re-adding CNAMEs to local.edgecdn_cname (after state rm in selectel-relay)
# puts EdgeCenter -> hub-production back in front.

output "edgecdn_cname" { value = local.edgecdn_cname }
output "hosts" { value = local.hosts }
