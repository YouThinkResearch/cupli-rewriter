variable "edgecenter_api_token" {
  description = "Permanent API token for EdgeCenter"
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "API token with DNS-edit rights for the zone"
  type        = string
  sensitive   = true
}

variable "railway_token" {
  description = "Railway API token (alternatively set env var RAILWAY_TOKEN)"
  type        = string
  sensitive   = true
}

variable "railway_source_repo" {
  description = "GitHub repository URL to deploy from"
  type        = string
  default     = "YouThinkResearch/cupli-rewriter"
}

variable "railway_source_repo_branch" {
  description = "Git branch to deploy"
  type        = string
  default     = "main"
}

variable "railway_root_directory" {
  description = "Repository subdirectory to use for the Railway service"
  type        = string
  default     = "/rewriter"
}

variable "railway_environment_name" {
  description = "Railway environment name"
  type        = string
  default     = "prod"
}

variable "rewritten_hosts" {
  description = "List of hosts to rewrite. Format: [[host, alias], ...]. Use '@' as alias for root domain."
  type        = list(list(string))

  validation {
    condition = length([
      for host in var.rewritten_hosts : host[1] if host[1] == "@"
    ]) <= 1
    error_message = "Only one host can use '@' as alias (root domain mapping)."
  }
}

variable "proxy_host" {
  description = "Proxy host"
  type        = string
}

variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "worker_name" {
  description = "Worker name"
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}

variable "relay_secret_key" {
  description = "Secret key for the relay"
  type        = string
  sensitive   = true
}

variable "cert_common_name" {
  description = "Primary domain on the certificate (same as CDN cname)"
  type        = string
}

variable "cert_sans" {
  description = "Optional SANs"
  type        = list(string)
  default     = []
}
