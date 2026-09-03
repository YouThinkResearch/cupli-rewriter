# Cloudflare DNS for the Yandex relay.
#
# These four records used to live in the edgecenter-relay-prosto state as CNAMEs to the
# EdgeCenter CDN; they were imported here and flipped to A records on the relay.
# The edgecenter state still lists them, so its config must NOT be applied for u-survey
# while this one is live - both would own the same names. The CI steps that did that are
# commented out in .github/workflows/update-terraform.yaml and are the rollback path.

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_zone_id" {
  type    = string
  default = "4d53c16d3b43cb1b5e8c54ec8e4bcc54" # u-survey.ru
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_dns_record" "relay" {
  for_each = toset(local.proxy_domains)

  zone_id = var.cloudflare_zone_id
  name    = each.value
  type    = "A"
  content = yandex_compute_instance.probe.network_interface.0.nat_ip_address
  ttl     = 300   # short while we watch the cutover; raise once it settles
  proxied = false # direct to Moscow, same posture as the EdgeCenter setup
}
