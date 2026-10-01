# s3explorer on the same Moscow box, behind the same Caddy.
#
# Separate null_resource from the rewriter deploy on purpose: a rewriter source change
# should not rebuild this app (npm ci + two vite/tsc builds), and vice versa.

variable "explorer_host" {
  description = "Hostname served by s3explorer"
  type        = string
  default     = "explorer.u-survey.ru"
}

variable "explorer_repo" {
  type    = string
  default = "https://github.com/blitss/s3explorer.git"
}

variable "explorer_ref" {
  description = "Pinned commit. Bump deliberately; `main` would redeploy on every apply."
  type        = string
  default     = "af30622904ec48d024a6718e4aee491eb603ed85"
}

variable "explorer_port" {
  description = "Must not be 3000 - the rewriter has it"
  type        = number
  default     = 3001
}

variable "explorer_data_dir" {
  description = "SQLite lives here, deliberately outside the build tree so a rebuild keeps it"
  type        = string
  default     = "/var/lib/s3explorer"
}

variable "explorer_app_dir" {
  type    = string
  default = "/opt/s3explorer"
}

variable "explorer_password" {
  description = "APP_PASSWORD for the UI"
  type        = string
  sensitive   = true
}

variable "explorer_session_secret" {
  description = "SESSION_SECRET; changing it invalidates existing sessions"
  type        = string
  sensitive   = true
}

locals {
  explorer_unit = templatefile("${path.module}/files/s3explorer.service.tftpl", {
    port     = var.explorer_port
    data_dir = var.explorer_data_dir
    app_dir  = var.explorer_app_dir
  })
}

resource "null_resource" "explorer" {
  triggers = {
    ref      = var.explorer_ref
    unit     = sha256(local.explorer_unit)
    script   = filesha256("${path.module}/files/explorer-apply.sh")
    instance = yandex_compute_instance.probe.id
    # secrets deliberately absent: trigger values are stored in state
  }

  connection {
    type        = "ssh"
    host        = yandex_compute_instance.probe.network_interface.0.nat_ip_address
    user        = "ubuntu"
    private_key = file(pathexpand(var.ssh_private_key))
    timeout     = "5m"
  }

  provisioner "file" {
    content     = local.explorer_unit
    destination = "/tmp/s3explorer.service"
  }

  provisioner "file" {
    content     = "APP_PASSWORD=${var.explorer_password}\nSESSION_SECRET=${var.explorer_session_secret}\n"
    destination = "/tmp/s3explorer.env"
  }

  provisioner "file" {
    source      = "${path.module}/files/explorer-apply.sh"
    destination = "/tmp/explorer-apply.sh"
  }

  provisioner "remote-exec" {
    inline = [
      "sudo REPO='${var.explorer_repo}' REF='${var.explorer_ref}' APP_DIR='${var.explorer_app_dir}' DATA_DIR='${var.explorer_data_dir}' bash /tmp/explorer-apply.sh",
    ]
  }
}

resource "cloudflare_dns_record" "explorer" {
  zone_id = var.cloudflare_zone_id
  name    = var.explorer_host
  type    = "A"
  content = yandex_compute_instance.probe.network_interface.0.nat_ip_address
  ttl     = 300
  proxied = false
}

output "explorer_url" { value = "https://${var.explorer_host}" }
