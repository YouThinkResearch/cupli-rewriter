# Origin Group
resource "edgecenter_cdn_origingroup" "origins" {
  name                 = var.origin_group_name
  use_next             = false
  consistent_balancing = false

  origin {
    source  = var.origin_source
    enabled = true
    backup  = false
  }
}

# CDN Resource
resource "edgecenter_cdn_resource" "cdn" {
  cname               = var.cname[0]
  origin_group        = edgecenter_cdn_origingroup.origins.id
  origin_protocol     = "HTTPS"
  secondary_hostnames = length(var.cname) > 1 ? slice(var.cname, 1, length(var.cname)) : []
  ssl_enabled         = var.ssl_enabled
  ssl_automated       = var.ssl_automated
  issue_le_cert       = var.issue_le_cert
  ssl_data            = var.ssl_cert_id
  active              = true
  description         = var.description

  options {
    # Host header configuration
    host_header {
      enabled = true
      value   = var.origin_source
    }

    # Static request headers - including the relay secret key
    static_request_headers {
      value = {
        "x-relay-secret-key" = var.relay_secret_key
      }
    }

    # Gzip compression configuration
    gzip_compression {
      enabled = false
      value = [
        "application/javascript",
        "application/xml+rss",
        "application/x-javascript",
        "text/css",
        "text/xml",
        "text/javascript",
        "application/json",
        "text/plain",
        "application/xml",
        "text/html"
      ]
    }

    # STALE configuration
    stale {
      enabled = false
      value = [
        "error",
        "updating"
      ]
    }

    # CORS configuration
    cors {
      enabled = false
      always  = false
      value = [
        "*"
      ]
    }

    # Response headers hiding policy
    response_headers_hiding_policy {
      enabled = false
      mode    = "hide"
      excepted = [
        "etag",
        "server",
        "content-type",
        "expires",
        "content-length",
        "cache-control",
        "content-encoding",
        "date",
        "last-modified",
        "connection",
        "accept-ranges",
        "vary",
        "keep-alive"
      ]
    }

    # Fetch compressed configuration
    fetch_compressed {
      enabled = true
      value   = true
    }

    # SNI configuration
    sni {
      enabled         = true
      sni_type        = "custom"
      custom_hostname = var.origin_source
    }

    # Limit bandwidth configuration
    limit_bandwidth {
      enabled    = false
      limit_type = "static"
      speed      = 50
      buffer     = 500
    }

    # Edge cache settings
    edge_cache_settings {
      enabled = false
      default = "4d"
    }

    # TLS versions configuration
    tls_versions {
      enabled = true
      value = [
        "TLSv1.3",
        "TLSv1.2"
      ]
    }

    # HTTP/3 enabled
    http3_enabled {
      enabled = true
      value   = true
    }
  }
}

# Dynamic CDN Rules
resource "edgecenter_cdn_rule" "cached_rules" {
  for_each = { for idx, rule in var.cached_rules : idx => rule }

  resource_id     = edgecenter_cdn_resource.cdn.id
  name            = each.value.name
  rule            = each.value.rule
  origin_protocol = "HTTPS"
  weight          = each.value.weight
  active          = true

  options {
    # STALE configuration for the rule
    stale {
      enabled = true
      value = [
        "error",
        "updating"
      ]
    }

    # Edge cache settings
    edge_cache_settings {
      enabled = true
      value   = each.value.cache_duration
    }
  }

  depends_on = [edgecenter_cdn_resource.cdn]
}
