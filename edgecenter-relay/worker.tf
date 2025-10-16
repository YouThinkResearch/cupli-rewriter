locals {
  worker_name = "rewritter"
  worker_file = "${path.module}/../rewriter/dist/index.js"
}

# KV Namespace for IP lookup cache
resource "cloudflare_workers_kv_namespace" "ip_lookup_cache" {
  account_id = var.account_id
  title      = "IP_LOOKUP_CACHE"
}

resource "cloudflare_workers_script_subdomain" "rewriter" {
  account_id       = var.account_id
  script_name      = local.worker_name
  enabled          = true
  previews_enabled = false
}

# Worker resource (replaces cloudflare_workers_script)
resource "cloudflare_worker" "rewriter" {
  account_id = var.account_id
  name       = local.worker_name

  subdomain = {
    enabled          = true
    previews_enabled = false
  }

  observability = {
    enabled = true
    logs = {
      invocation_logs = true
    }
  }
}

# Worker version with code and bindings
# Note: Changes to bindings will automatically trigger a new version
resource "cloudflare_worker_version" "rewriter" {
  account_id = var.account_id
  worker_id  = cloudflare_worker.rewriter.id

  compatibility_date = "2025-05-05"
  main_module        = "worker.js"

  modules = [
    {
      name         = "worker.js"
      content_file = local.worker_file
      content_type = "application/javascript+module"
    }
  ]

  bindings = [
    {
      type         = "kv_namespace"
      name         = "IP_LOOKUP_CACHE"
      namespace_id = cloudflare_workers_kv_namespace.ip_lookup_cache.id
    },
    {
      type = "plain_text"
      name = "PROXY_HOST"
      text = var.proxy_host
    },
    {
      type = "secret_text"
      name = "RELAY_SECRET_KEY"
      text = var.relay_secret_key
    },
    {
      type = "plain_text"
      name = "REWRITTEN_HOSTS"
      text = jsonencode(var.rewritten_hosts)
    }
  ]
}

# Deploy the worker version
resource "cloudflare_workers_deployment" "rewriter" {
  account_id  = var.account_id
  script_name = cloudflare_worker.rewriter.name

  strategy = "percentage"

  versions = [
    {
      version_id = cloudflare_worker_version.rewriter.id
      percentage = 100
    }
  ]
}
