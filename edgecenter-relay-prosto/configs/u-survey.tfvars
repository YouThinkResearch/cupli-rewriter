account_id  = "ce0c2881f5d5e766cf80d99473b5f220"
zone_id     = "4d53c16d3b43cb1b5e8c54ec8e4bcc54"
proxy_host  = "u-survey.ru"
worker_name = "rewritter-usurvey"

# List of hosts to rewrite
rewritten_hosts = [
  ["survey.alchemer.com", "survey"],
  ["www.surveygizmo.com", "gzmo"],
  ["surveygizmolibrary.s3.amazonaws.com", "gzmos3"],
  ["d3hz8hujpo34t2.cloudfront.net", "gzmocfr"]
]

# Certificate configuration
cert_common_name = "*.u-survey.ru"
cert_sans = [
  "u-survey.ru"
]

