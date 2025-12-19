# Consolidated outputs keyed by site key

output "cdn_resource_ids" {
  description = "CDN resource IDs keyed by site key"
  value       = { for k, m in module.cdn : k => m.cdn_resource_id }
}

output "cdn_cnames" {
  description = "CDN CNAMEs keyed by site key"
  value       = { for k, m in module.cdn : k => m.cname }
}

output "cdn_statuses" {
  description = "CDN resource statuses keyed by site key"
  value       = { for k, m in module.cdn : k => m.status }
}

output "railway_tcp_proxy_domain" {
  description = "Railway TCP proxy domain (hostname only)"
  value       = railway_tcp_proxy.rewriter.domain
}

output "railway_tcp_proxy_port" {
  description = "Railway TCP proxy external port"
  value       = railway_tcp_proxy.rewriter.proxy_port
}

output "railway_origin_source" {
  description = "Origin address used by EdgeCenter (host:port)"
  value       = local.railway_origin_source
}
