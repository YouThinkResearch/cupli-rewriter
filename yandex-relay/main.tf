# Yandex Cloud Moscow probe: compare the AWS/Alchemer egress path against Timeweb.

terraform {
  required_version = ">= 1.5"

  # Same Cloudflare R2 bucket as edgecenter-relay-prosto, different key.
  backend "s3" {
    bucket = "terraform-rewriter-state"
    key    = "relay-yandex/terraform.tfstate"
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
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "~> 0.225"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "sa_key_file" {
  description = "Service account authorized key JSON"
  type        = string
}

variable "cloud_id" {
  type    = string
  default = "b1gf2hl546mk7elfmp0k"
}

variable "folder_id" {
  type    = string
  default = "b1gpa95msudme4jo5n6h"
}

variable "zone" {
  type    = string
  default = "ru-central1-a" # Moscow
}

variable "ssh_public_key" {
  description = "Operator key"
  type        = string
  default     = "./keys/operator.pub"
}

variable "ci_public_key" {
  description = "Dedicated CI deploy key, so the pipeline never needs an operator's personal key"
  type        = string
  default     = "./keys/ci.pub"
}

variable "proxy_host" {
  type    = string
  default = "u-survey.ru"
}

variable "rewritten_hosts" {
  description = "[[upstream_host, alias], ...] - alias becomes <alias>.<proxy_host>"
  type        = list(list(string))
  default = [
    ["survey.alchemer.com", "survey"],
    ["www.surveygizmo.com", "gzmo"],
    ["surveygizmolibrary.s3.amazonaws.com", "gzmos3"],
    ["d3hz8hujpo34t2.cloudfront.net", "gzmocfr"],
  ]
}

variable "relay_secret_key" {
  description = "Unused by the bun handler (only the CF Worker gates on it); kept for parity"
  type        = string
  default     = ""
  sensitive   = true
}

variable "acme_email" {
  type    = string
  default = "admin@u-survey.ru"
}

locals {
  # <alias>.<proxy_host>, or the bare proxy host when the alias is "@"
  proxy_domains = [
    for h in var.rewritten_hosts :
    h[1] == "@" ? var.proxy_host : "${h[1]}.${var.proxy_host}"
  ]
}

provider "yandex" {
  service_account_key_file = var.sa_key_file
  cloud_id                 = var.cloud_id
  folder_id                = var.folder_id
  zone                     = var.zone
}

data "yandex_compute_image" "ubuntu" {
  family = "ubuntu-2404-lts"
}

# Own network so we never touch the existing k8s VPC.
resource "yandex_vpc_network" "probe" {
  name = "cupli-probe-net"
}

resource "yandex_vpc_subnet" "probe" {
  name           = "cupli-probe-subnet"
  zone           = var.zone
  network_id     = yandex_vpc_network.probe.id
  v4_cidr_blocks = ["10.200.0.0/24"]
}

# Reserved AFTER the fact, not allocated up front. A freshly reserved address comes
# from the pool at random and can be one backbone carriers blackhole (we burned two
# that way); the working procedure is to cycle ephemeral IPs until SSH answers, then
# flip that address to reserved and pin it here.
resource "yandex_vpc_address" "probe" {
  name                = "cupli-probe-addr"
  deletion_protection = true

  external_ipv4_address {
    zone_id = var.zone
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_compute_instance" "probe" {
  name        = "cupli-msk-probe"
  platform_id = "standard-v3"
  zone        = var.zone

  resources {
    cores         = 2
    core_fraction = 20
    memory        = 2
  }

  boot_disk {
    initialize_params {
      image_id = data.yandex_compute_image.ubuntu.id
      size     = 15
    }
  }

  network_interface {
    subnet_id          = yandex_vpc_subnet.probe.id
    security_group_ids = [yandex_vpc_security_group.probe.id]
    nat                = true
    nat_ip_address     = yandex_vpc_address.probe.external_ipv4_address[0].address
  }

  metadata = {
    ssh-keys = join("\n", compact([
      "ubuntu:${trimspace(file(pathexpand(var.ssh_public_key)))}",
      var.ci_public_key == "" ? "" : "ubuntu:${trimspace(file(pathexpand(var.ci_public_key)))}",
    ]))
    user-data = file("${path.module}/cloud-init.yaml.tftpl")
  }
}

output "probe_ip" { value = yandex_compute_instance.probe.network_interface.0.nat_ip_address }

output "proxy_domains" { value = local.proxy_domains }
