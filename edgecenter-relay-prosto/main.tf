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
  worker_name = var.worker_name

  # Parse the API response
  cdn_client_info = jsondecode(data.http.edgecenter_cdn_client.response_body)
  edgecdn_cname   = local.cdn_client_info.cname

  rewritten_domains = var.rewritten_hosts

  # Transform rewritten_domains into the target format (full FQDNs for EdgeCenter CDN)
  # If an alias is provided, use only the alias; otherwise use the dashed format
  transformed_cnames = [
    for domain in local.rewritten_domains :
    domain[1] != null ? (domain[1] == "@" ? var.proxy_host : "${domain[1]}.${var.proxy_host}") : "${replace(domain[0], ".", "--")}.${var.proxy_host}"
  ]

  # For Cloudflare DNS records, we need just the subdomain part or "@"
  cloudflare_dns_names = {
    for fqdn in local.transformed_cnames :
    fqdn => fqdn == var.proxy_host ? "@" : trimsuffix(fqdn, ".${var.proxy_host}")
  }

  cdn_sites = {
    hub = {
      cname           = local.transformed_cnames
      origin_source   = local.railway_origin_source
      origin_protocol = "HTTP"
      description     = ""
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

resource "railway_project" "rewriter" {
  name = "cupli-rewritter"
}

resource "railway_environment" "production" {
  name       = "production"
  project_id = railway_project.rewriter.id
}

resource "railway_service" "rewriter" {
  name       = local.worker_name
  project_id = railway_project.rewriter.id
  regions = [
    {
      num_replicas = 1
      region       = "europe-west4-drams3a"
    }
  ]

  source_repo        = var.railway_source_repo
  source_repo_branch = var.railway_source_repo_branch
  root_directory     = var.railway_root_directory
}

resource "railway_variable_collection" "rewriter_env" {
  environment_id = railway_environment.production.id
  service_id     = railway_service.rewriter.id

  variables = [
    {
      name  = "PROXY_HOST"
      value = var.proxy_host
    },
    {
      name  = "RELAY_SECRET_KEY"
      value = var.relay_secret_key
    },
    {
      name  = "REWRITTEN_HOSTS"
      value = jsonencode(var.rewritten_hosts)
    }
  ]
}

resource "railway_tcp_proxy" "rewriter" {
  environment_id   = railway_environment.production.id
  service_id       = railway_service.rewriter.id
  application_port = 8080

  depends_on = [railway_variable_collection.rewriter_env]
}

locals {
  # Railway TCP proxy exposes {domain}:{proxy_port} externally.
  railway_origin_host   = railway_tcp_proxy.rewriter.domain
  railway_origin_source = "${railway_tcp_proxy.rewriter.domain}:${railway_tcp_proxy.rewriter.proxy_port}"
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
  for_each = local.cloudflare_dns_names

  zone_id = var.zone_id
  name    = each.value # "@" for root, or just subdomain part
  type    = "CNAME"
  content = local.edgecdn_cname
  ttl     = 3600
}
