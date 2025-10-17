output "origin_group_id" {
  description = "ID of the created origin group"
  value       = edgecenter_cdn_origingroup.origins.id
}

output "cdn_resource_id" {
  description = "ID of the created CDN resource"
  value       = edgecenter_cdn_resource.cdn.id
}

output "cdn_rule_ids" {
  description = "IDs of the created CDN rules"
  value       = { for k, v in edgecenter_cdn_rule.cached_rules : k => v.id }
}

output "cname" {
  description = "CNAME of the CDN resource"
  value       = edgecenter_cdn_resource.cdn.cname
}

output "status" {
  description = "Status of the CDN resource"
  value       = edgecenter_cdn_resource.cdn.status
}
