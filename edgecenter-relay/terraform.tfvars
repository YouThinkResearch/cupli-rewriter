

account_id = "5cbd25b113ce377352027b6e84867d15"
zone_id    = "b4dc00bd73c7b0de523c3fbd2e1ccd1d"
proxy_host = "fwd.youthink.dev"

# List of hosts to rewrite
rewritten_hosts = [
  ["go.cup.li", null],
  ["survey.alchemer.com", "surveys"],
  ["www.surveygizmo.com", "gzmo"],
  ["surveygizmolibrary.s3.amazonaws.com", "gzmos3"],
  ["d3hz8hujpo34t2.cloudfront.net", "gzmocfr"]
]

# Certificate configuration
cert_common_name = "*.fwd.youthink.dev"
cert_sans        = []
