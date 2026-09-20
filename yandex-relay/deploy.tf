# Convergent config delivery.
#
# cloud-init only bootstraps packages, and it runs once at first boot - editing its
# template changes nothing on a running machine. Everything that actually changes
# (Caddyfile, unit, app bundle, certs) is pushed from here instead, keyed on content
# hashes, so `terraform apply` converges the live box without recreating it. The IP is
# pinned and must survive, so recreation is not an option.

variable "cache_ttl" {
  description = "souin edge-cache lifetime for entries upstream marks cacheable"
  type        = string
  default     = "86400s"
}

variable "cache_stale" {
  description = "how long a stale entry may still be served while revalidating"
  type        = string
  default     = "3600s"
}

variable "ssh_private_key" {
  description = "Private key matching var.ssh_public_key, used to push config"
  type        = string
  default     = "~/.ssh/id_ed25519_new" # CI overrides this with the deploy key
}

locals {
  bundle_src = "${path.module}/../rewriter/dist/bun-handler.js"

  caddyfile = templatefile("${path.module}/files/Caddyfile.tftpl", {
    acme_email  = var.acme_email
    caddy_hosts = join(", ", local.proxy_domains)
    cache_ttl   = var.cache_ttl
    cache_stale = var.cache_stale
  })

  rewriter_unit = templatefile("${path.module}/files/rewriter.service.tftpl", {
    proxy_host                   = var.proxy_host
    rewritten_hosts_json_escaped = replace(jsonencode(var.rewritten_hosts), "\"", "\\\"")
    relay_secret_key             = var.relay_secret_key
  })

  # Hash the app sources, not dist/: dist is rebuilt below during apply, so hashing it
  # would read the previous build and never notice a source change.
  src_hash = sha256(join("", [
    for f in fileset("${path.module}/../rewriter/src", "**/*.ts") :
    filesha256("${path.module}/../rewriter/src/${f}")
  ]))
}

resource "null_resource" "deploy" {
  triggers = {
    src       = local.src_hash
    caddyfile = sha256(local.caddyfile)
    unit      = sha256(local.rewriter_unit)
    apply_sh  = filesha256("${path.module}/files/apply.sh")
    instance  = yandex_compute_instance.probe.id
    domains   = join(",", local.proxy_domains)
    # deliberately NOT the cloudflare token: triggers are stored in state
  }

  connection {
    type        = "ssh"
    host        = yandex_compute_instance.probe.network_interface.0.nat_ip_address
    user        = "ubuntu"
    private_key = file(pathexpand(var.ssh_private_key))
    timeout     = "3m"
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../rewriter"
    command     = "PATH=$HOME/.bun/bin:$PATH bun build.ts"
  }

  provisioner "file" {
    source      = local.bundle_src
    destination = "/tmp/bun-handler.js"
  }

  provisioner "file" {
    content     = local.caddyfile
    destination = "/tmp/Caddyfile"
  }

  provisioner "file" {
    content     = local.rewriter_unit
    destination = "/tmp/rewriter.service"
  }

  provisioner "file" {
    content     = var.ci_public_key == "" ? "" : file(pathexpand(var.ci_public_key))
    destination = "/tmp/ci_key.pub"
  }

  provisioner "file" {
    source      = "${path.module}/files/apply.sh"
    destination = "/tmp/apply.sh"
  }

  provisioner "remote-exec" {
    inline = [
      "sudo bash /tmp/apply.sh",
    ]
  }
}
