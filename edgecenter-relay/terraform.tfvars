

account_id = "ce0c2881f5d5e766cf80d99473b5f220"
zone_id    = "55526c5ad53433e15e69e983db213e7b"
proxy_host = "freesurveycupli.com"

# List of hosts to rewrite
rewritten_hosts = [
  ["survey.alchemer.com", "@"],
  ["www.surveygizmo.com", "gzmo"],
  ["surveygizmolibrary.s3.amazonaws.com", "gzmos3"],
  ["d3hz8hujpo34t2.cloudfront.net", "gzmocfr"]
]

# Certificate configuration
cert_common_name = "*.freesurveycupli.com"
cert_sans = [
  "freesurveycupli.com"
]
