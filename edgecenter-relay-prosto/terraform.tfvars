

account_id  = "ce0c2881f5d5e766cf80d99473b5f220"
zone_id     = "5af84856356b9ff933c4a419ac2e088e"
proxy_host  = "prostocupli.com"
worker_name = "rewritter-prosto"

# List of hosts to rewrite
rewritten_hosts = [
  ["survey.alchemer.com", "survey"],
  ["www.surveygizmo.com", "gzmo"],
  ["surveygizmolibrary.s3.amazonaws.com", "gzmos3"],
  ["d3hz8hujpo34t2.cloudfront.net", "gzmocfr"]
]

# Certificate configuration
cert_common_name = "*.prostocupli.com"
cert_sans = [
  "prostocupli.com"
]
