# Upload the Let's Encrypt certificate to EdgeCenter
resource "random_id" "cert_suffix" {
  byte_length = 4
  keepers = {
    cert_pem_sha256 = sha256(acme_certificate.le_cert.certificate_pem)
  }
}

resource "edgecenter_cdn_sslcert" "le" {
  name = "${var.cert_common_name}-le-${random_id.cert_suffix.hex}"

  # ACME outputs - use leaf first, then chain
  cert        = "${acme_certificate.le_cert.certificate_pem}${acme_certificate.le_cert.issuer_pem}"
  private_key = acme_certificate.le_cert.private_key_pem

  # Auto-replace on renewal
  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      acme_certificate.le_cert
    ]
  }
}
