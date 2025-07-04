# Upload the Let's Encrypt certificate to EdgeCenter
resource "edgecenter_cdn_sslcert" "le" {
  name = "${var.cert_common_name}-le-${acme_certificate.le_cert.certificate_serial}"

  # ACME outputs
  cert        = acme_certificate.le_cert.certificate_pem
  private_key = acme_certificate.le_cert.private_key_pem

  # Auto-replace on renewal
  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      acme_certificate.le_cert
    ]
  }
}
