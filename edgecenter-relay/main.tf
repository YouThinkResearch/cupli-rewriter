# -----------------------------------------------------------------------------
# Root module – instantiate edgecenter-cdn module for every site in local map
# -----------------------------------------------------------------------------

# Fetch EdgeCenter CDN client info
data "http" "edgecenter_cdn_client" {
  url = "https://api.edgecenter.ru/cdn/clients/me"

  request_headers = {
    Authorization = "APIKey ${var.edgecenter_api_token}"
  }
}

locals {
  # Parse the API response
  cdn_client_info = jsondecode(data.http.edgecenter_cdn_client.response_body)
  edgecdn_cname   = local.cdn_client_info.cname

  rewritten_domains = var.rewritten_hosts

  # Transform rewritten_domains into the target format
  transformed_cnames = compact(flatten([
    for domain in local.rewritten_domains :
    [
      "${replace(domain[0], ".", "--")}.${var.proxy_host}",
      domain[1] != null ? "${domain[1]}.${var.proxy_host}" : null
    ]
  ]))

  cdn_sites = {
    hub = {
      cname         = local.transformed_cnames
      origin_source = "rewritter.youthink.workers.dev"
      description   = ""
      cached_rules = [
        {
          name           = "Static content"
          rule           = "^/.*\\.(js|mjs|css|bmp|jpg|jpeg|gif|png|svg|ico|json|ttf|ttc|otf|eot|woff|woff2|webp|zip|tgz|gz|rar|bz2|doc|docx|rtf|xls|xlsx|exe|pdf|ppt|pptx|txt|tar|mid|midi|wav|swf|flv|mp3|mp4)$"
          weight         = 1
          cache_duration = "345600s" # 4 days
        }
      ]
    }
  }
}

module "cdn" {
  for_each = local.cdn_sites
  source   = "./modules/edgecenter-cdn"

  cname             = each.value.cname
  origin_source     = each.value.origin_source
  origin_group_name = "Origins for ${each.value.cname[0]}"
  relay_secret_key  = var.relay_secret_key
  description       = each.value.description
  cached_rules      = each.value.cached_rules

  # SSL configuration - use ACME certificate
  ssl_cert_id   = edgecenter_cdn_sslcert.le.id
  ssl_enabled   = true
  ssl_automated = false # we bring our own
}

# Create individual CNAME records for each transformed domain
resource "cloudflare_dns_record" "edgecenter_cnames" {
  for_each = toset(local.transformed_cnames)

  zone_id = var.zone_id
  name    = each.value
  type    = "CNAME"
  content = local.edgecdn_cname
  ttl     = 3600
}
