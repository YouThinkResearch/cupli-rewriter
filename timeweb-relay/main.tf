# Timeweb probe VPS: does a Russian Timeweb host actually reach Alchemer/AWS,
# and does TSPU/DPI let the TLS handshake through?

data "twc_os" "ubuntu" {
  name    = "ubuntu"
  version = "26.04"
}

resource "twc_ssh_key" "probe" {
  name = "cupli-probe"
  body = file(pathexpand(var.ssh_public_key))
}

resource "twc_server" "probe" {
  name              = "cupli-msk-probe"
  comment           = "Managed by Terraform - Alchemer reachability probe"
  hostname          = "cupli-msk-probe"
  os_id             = data.twc_os.ubuntu.id
  preset_id         = var.preset_id
  availability_zone = "msk-1"

  ssh_keys_ids              = [twc_ssh_key.probe.id]
  is_root_password_required = false
}

output "probe_ip" { value = twc_server.probe.main_ipv4 }
output "probe_location" { value = twc_server.probe.location }

# Timeweb hands out only IPv6 by default; public IPv4 is a separate floating IP.
resource "twc_floating_ip" "probe" {
  availability_zone = "msk-1"
  comment           = "cupli-msk-probe public IPv4"

  resource {
    id   = twc_server.probe.id
    type = "server"
  }
}

output "probe_ipv4" { value = twc_floating_ip.probe.ip }
