# Selectel Moscow (ru-9) relay for u-survey.ru — same shape as yandex-relay/, which
# died with Yandex ru-central1-a on 2026-10-11.
#
# Measured from a probe VM in this region before committing to it: 400/400 HTTPS to
# the four Alchemer/gizmo upstreams with zero SYN retransmits, and a 3-hop path to a
# CloudFront edge at ~1.5ms (Selectel peers with CloudFront in Moscow; Yandex went via
# Warsaw). The floating IP was verified reachable from Georgia and from a US GitHub
# runner (50/50), so it is imported and pinned rather than allocated fresh.

terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "terraform-rewriter-state"
    key    = "relay-selectel/terraform.tfstate"
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
    openstack = {
      source  = "terraform-provider-openstack/openstack"
      version = "~> 3.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

variable "selectel_api_token" {
  description = "Selectel static API key (X-Token)"
  type        = string
  sensitive   = true
}

variable "selectel_project_id" {
  type    = string
  default = "3c42c0918d304293a5710dfd5e4e63ce"
}

variable "region" {
  type    = string
  default = "ru-9" # Moscow
}

variable "flavor" {
  # Full vCPUs. The PRC10/20/50 lines are a fraction of a core — the 20% Yandex
  # core_fraction already starved this proxy once.
  description = "SL1.1-2048: 1 vCPU / 2GB standard line (full core)"
  type        = string
  default     = "1012"
}

variable "image_id" {
  # PINNED. A floating "latest image" lookup rebuilt the Yandex VM twice.
  description = "Ubuntu 24.04 LTS 64-bit"
  type        = string
  default     = "ca9f38d8-ed43-435f-9729-8068d4da3f2f"
}

variable "ssh_public_key" {
  type    = string
  default = "./keys/operator.pub"
}

variable "ci_public_key" {
  type    = string
  default = "./keys/ci.pub"
}

variable "proxy_host" {
  type    = string
  default = "u-survey.ru"
}

variable "rewritten_hosts" {
  type = list(list(string))
  default = [
    ["survey.alchemer.com", "survey"],
    ["www.surveygizmo.com", "gzmo"],
    ["surveygizmolibrary.s3.amazonaws.com", "gzmos3"],
    ["d3hz8hujpo34t2.cloudfront.net", "gzmocfr"],
  ]
}

variable "relay_secret_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "acme_email" {
  type    = string
  default = "admin@u-survey.ru"
}

locals {
  az = "${var.region}a"
  proxy_domains = [
    for h in var.rewritten_hosts :
    h[1] == "@" ? var.proxy_host : "${h[1]}.${var.proxy_host}"
  ]
}

# The static X-Token cannot talk to OpenStack directly; exchange it for a
# project-scoped Keystone token on every run (they expire after ~24h).
data "http" "keystone" {
  url    = "https://api.selectel.ru/vpc/resell/v2/tokens"
  method = "POST"
  request_headers = {
    "X-Token"      = var.selectel_api_token
    "Content-Type" = "application/json"
  }
  request_body = jsonencode({ token = { project_id = var.selectel_project_id } })
}

provider "openstack" {
  auth_url  = "https://cloud.api.selcloud.ru/identity/v3"
  token     = jsondecode(data.http.keystone.response_body).token.id
  tenant_id = var.selectel_project_id
  region    = var.region
}

data "openstack_networking_network_v2" "external" {
  name = "external-network"
}

resource "openstack_networking_network_v2" "relay" {
  name = "cupli-relay"
}

resource "openstack_networking_subnet_v2" "relay" {
  name            = "cupli-relay"
  network_id      = openstack_networking_network_v2.relay.id
  cidr            = "192.168.60.0/24"
  dns_nameservers = ["188.93.16.19", "188.93.17.19"]
}

resource "openstack_networking_router_v2" "relay" {
  name                = "cupli-relay"
  external_network_id = data.openstack_networking_network_v2.external.id
}

resource "openstack_networking_router_interface_v2" "relay" {
  router_id = openstack_networking_router_v2.relay.id
  subnet_id = openstack_networking_subnet_v2.relay.id
}

resource "openstack_compute_keypair_v2" "relay" {
  name       = "cupli-relay"
  public_key = trimspace(file(pathexpand(var.ssh_public_key)))
}

resource "openstack_blockstorage_volume_v3" "boot" {
  name              = "cupli-relay-boot"
  size              = 20
  image_id          = var.image_id
  volume_type       = "fast.${local.az}"
  availability_zone = local.az

  lifecycle {
    prevent_destroy = true
  }
}

resource "openstack_compute_instance_v2" "relay" {
  name              = "cupli-relay"
  flavor_id         = var.flavor
  key_pair          = openstack_compute_keypair_v2.relay.name
  availability_zone = local.az
  user_data         = file("${path.module}/cloud-init.yaml.tftpl")

  block_device {
    uuid             = openstack_blockstorage_volume_v3.boot.id
    source_type      = "volume"
    destination_type = "volume"
    boot_index       = 0
  }

  network {
    uuid = openstack_networking_network_v2.relay.id
  }

  # Losing this VM means a new IP and a fresh cert; never let an apply do it.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [user_data, key_pair, security_groups]
  }

  depends_on = [openstack_networking_router_interface_v2.relay]
}

# Imported from the probe: verified reachable from inside and outside Russia.
import {
  to = openstack_networking_floatingip_v2.relay
  id = "6d2c39f2-5b92-42e2-bfee-7295ab929817"
}

resource "openstack_networking_floatingip_v2" "relay" {
  pool = "external-network"

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [port_id, fixed_ip]
  }
}

resource "openstack_networking_floatingip_associate_v2" "relay" {
  floating_ip = openstack_networking_floatingip_v2.relay.address
  port_id     = data.openstack_networking_port_v2.relay.id

  lifecycle {
    ignore_changes = [port_id] # same reason as the secgroup association
  }
}

output "relay_ip" { value = openstack_networking_floatingip_v2.relay.address }
output "proxy_domains" { value = local.proxy_domains }
