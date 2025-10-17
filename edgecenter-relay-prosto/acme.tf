# Register with Let's Encrypt (account key is generated automatically)
resource "acme_registration" "reg" {
  email_address = "s.orlov@cup.li"
}

# Request the certificate using DNS-01 challenge via Cloudflare
resource "acme_certificate" "le_cert" {
  account_key_pem           = acme_registration.reg.account_key_pem
  common_name               = var.cert_common_name
  subject_alternative_names = var.cert_sans

  # DNS-01 using Cloudflare
  dns_challenge {
    provider = "cloudflare"

    # CF_DNS_API_TOKEN = DNS edit permission
    # CF_ZONE_API_TOKEN = Zone read permission (to find the right zone)
    config = {
      CF_DNS_API_TOKEN  = var.cloudflare_api_token
      CF_ZONE_API_TOKEN = var.cloudflare_api_token
    }
  }
}
