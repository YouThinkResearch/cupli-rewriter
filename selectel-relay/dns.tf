# Cloudflare via the Cupli account global key.
variable "cloudflare_api_key" {
  type      = string
  sensitive = true
}

variable "cloudflare_email" {
  type    = string
  default = "andrew@streamloop.app"
}

variable "cloudflare_zone_id" {
  type    = string
  default = "4d53c16d3b43cb1b5e8c54ec8e4bcc54" # u-survey.ru
}

# false: u-survey.ru stays on EdgeCenter -> hub-production (edgecenter-hub/) while
# this box is built and verified. true: the four names point here.
# The records are imported, not created: before flipping, rewrite them in place to
# A -> relay_ip via the API so the import shows no diff. Recreating them (CNAME->A is
# a type change, i.e. destroy+create) opens an NXDOMAIN window that resolvers cache
# for the zone's SOA minimum of 30 minutes - that already caused one "outage".
variable "cutover" {
  type    = bool
  default = true
}

variable "relay_record_ids" {
  description = "existing Cloudflare record ids for the four names, imported on cutover"
  type        = map(string)
  default = {
    survey  = "5f4b87b45d3234f2b929bb1f0e435ac4"
    gzmo    = "e41081751b781e2b930264786aaacb14"
    gzmos3  = "8e3982c15f26dd209689c3547da9fb93"
    gzmocfr = "151d7d3553a50618497c3f555edf7d01"
  }
}

provider "cloudflare" {
  api_key = var.cloudflare_api_key
  email   = var.cloudflare_email
}

import {
  for_each = var.cutover ? var.relay_record_ids : {}
  to       = cloudflare_dns_record.relay[each.key]
  id       = "${var.cloudflare_zone_id}/${each.value}"
}

resource "cloudflare_dns_record" "relay" {
  for_each = var.cutover ? var.relay_record_ids : {}

  zone_id = var.cloudflare_zone_id
  name    = "${each.key}.${var.proxy_host}"
  type    = "A"
  content = openstack_networking_floatingip_v2.relay.address
  ttl     = 300
  proxied = false
}
