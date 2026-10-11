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

# The survey/gzmo/gzmos3/gzmocfr records moved to edgecenter-hub/ on 2026-10-11, when
# ru-central1-a was lost and u-survey.ru went back behind EdgeCenter. They were removed
# from this state with `terraform state rm`; do not re-add them here, or two configs
# own the same names again.
