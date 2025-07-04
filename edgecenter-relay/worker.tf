locals {
  worker_name = "rewritter"
  worker_js   = file("${path.module}/../rewriter/dist/index.js")
  // workaround for https://github.com/cloudflare/terraform-provider-cloudflare/issues/5439#issuecomment-3031284642
  env_signature = sha256("${var.proxy_host}:${var.relay_secret_key}:${jsonencode(var.rewritten_hosts)}")
}

resource "cloudflare_workers_script_subdomain" "rewriter" {
  account_id       = var.account_id
  script_name      = local.worker_name
  enabled          = true
  previews_enabled = false
}

// v5 is kinda screwed: https://github.com/cloudflare/terraform-provider-cloudflare/issues/5573
// https://github.com/cloudflare/terraform-provider-cloudflare/issues/5439#issuecomment-3031284642
resource "cloudflare_workers_script" "rewriter" {
  account_id         = var.account_id
  content            = "${local.worker_js}\n// ${local.env_signature}"
  script_name        = local.worker_name
  compatibility_date = "2025-05-05"
  main_module        = "worker.js"

  observability = {
    enabled = true
    logs = {
      invocation_logs = true
      enabled         = true
    }
  }
  bindings = [
    {
      name = "PROXY_HOST"
      type = "plain_text"
      text = var.proxy_host
    },
    {
      name = "RELAY_SECRET_KEY"
      type = "secret_text",
      text = var.relay_secret_key
    },
    // i'd love to use a json type here, but cf terraform provider is broken
    // and outputs invalid json in the actual worker config
    {
      name = "REWRITTEN_HOSTS"
      type = "plain_text"
      text = jsonencode(var.rewritten_hosts)
    },
  ]

  # lifecycle {
  #   ignore_changes = [
  #     etag,
  #     has_assets,
  #     has_modules,
  #     modified_on,
  #     migrations,
  #     placement,
  #     tail_consumers,
  #   ]
  # }
}
