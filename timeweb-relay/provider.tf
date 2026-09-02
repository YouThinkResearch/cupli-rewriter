terraform {
  required_version = ">= 1.5"
  required_providers {
    twc = {
      source  = "timeweb-cloud/timeweb-cloud"
      version = "~> 1.8"
    }
  }
}

provider "twc" {
  token = var.twc_token
}

variable "twc_token" {
  description = "Timeweb Cloud API token (set via TF_VAR_twc_token)"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "Public key installed on the probe VPS"
  type        = string
  default     = "~/.ssh/id_ed25519_new.pub"
}

# 2573 = ru-1 / SPB, SSD-15, 149 RUB/mo  (feasibility probe)
# 4799 = ru-3 / MSK, Cloud MSK 40, 2vCPU/2GB/40GB,  800 RUB/mo
# 4801 = ru-3 / MSK, Cloud MSK 50, 2vCPU/4GB/50GB, 1000 RUB/mo (current)
variable "preset_id" {
  description = "Timeweb server preset"
  type        = number
  default     = 4801
}
