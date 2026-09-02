# Without a security group Yandex leaves every port open, which exposed the bun
# handler on :3000 directly to the internet - plain HTTP, no TLS, Caddy bypassed.
# Scanners found it and their probes were most of the rewriter's "Not found" noise.
resource "yandex_vpc_security_group" "probe" {
  name       = "cupli-probe-sg"
  network_id = yandex_vpc_network.probe.id

  ingress {
    protocol       = "TCP"
    description    = "HTTP (ACME + redirect to HTTPS)"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 80
  }

  ingress {
    protocol       = "TCP"
    description    = "HTTPS"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 443
  }

  # QUIC. Caddy already advertises alt-svc h3=":443"; without this rule browsers
  # spend 30 days (ma=2592000) trying UDP, timing out and falling back to TCP.
  ingress {
    protocol       = "UDP"
    description    = "HTTP/3 (QUIC)"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 443
  }

  ingress {
    protocol       = "TCP"
    description    = "SSH"
    v4_cidr_blocks = ["0.0.0.0/0"]
    port           = 22
  }

  egress {
    protocol       = "ANY"
    description    = "outbound to Alchemer/AWS, AreaBook, ACME"
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}
