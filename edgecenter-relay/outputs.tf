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