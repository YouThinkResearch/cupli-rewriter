variable "cname" {
  description = "Array of CNAMEs for the CDN resource. First element will be primary CNAME, rest will be secondary hostnames"
  type        = list(string)
}

variable "origin_source" {
  description = "The origin address (hostname or hostname:port) that EdgeCenter will connect to"
  type        = string
}

variable "origin_protocol" {
  description = "Origin protocol (HTTP or HTTPS)"
  type        = string
  default     = "HTTP"

  validation {
    condition     = contains(["HTTP", "HTTPS"], upper(var.origin_protocol))
    error_message = "origin_protocol must be HTTP or HTTPS."
  }
}

variable "origin_group_name" {
  description = "Name for the origin group"
  type        = string
}

variable "relay_secret_key" {
  description = "Secret key for x-relay-secret-key header"
  type        = string
  default     = "p455w0rd-change-me"
}

variable "description" {
  description = "Description for the CDN resource"
  type        = string
  default     = ""
}

variable "ssl_cert_id" {
  description = "ID of the SSL certificate to use"
  type        = number
  default     = null
}

variable "ssl_enabled" {
  description = "Enable SSL for the CDN resource"
  type        = bool
  default     = true
}

variable "ssl_automated" {
  description = "Use automated Let's Encrypt certificate from EdgeCenter"
  type        = bool
  default     = false
}

variable "issue_le_cert" {
  description = "Issue a Let's Encrypt certificate from EdgeCenter"
  type        = bool
  default     = false
}

variable "cached_rules" {
  description = "List of caching rules to create"
  type = list(object({
    name           = string
    rule           = string
    weight         = optional(number, 1)
    cache_duration = optional(string, "86400s")
  }))
  default = []
}
