#!/usr/bin/env bash
# Idempotent config apply. Runs on every `terraform apply` whose triggers changed.
set -euo pipefail

install -m 0644 /tmp/rewriter.service /etc/systemd/system/rewriter.service
install -m 0644 /tmp/Caddyfile        /etc/caddy/Caddyfile
install -m 0644 /tmp/bun-handler.js   /opt/rewriter/bun-handler.js

# Terraform owns the unit now; a hand-made drop-in would silently outrank it.
rm -rf /etc/systemd/system/rewriter.service.d

# Yandex only writes ssh-keys metadata at boot, so a key added to a running instance
# never lands. Converge it here instead.
if [ -s /tmp/ci_key.pub ]; then
  install -d -m 0700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
  touch /home/ubuntu/.ssh/authorized_keys
  while read -r k; do
    [ -n "$k" ] || continue
    grep -qF "$k" /home/ubuntu/.ssh/authorized_keys || echo "$k" >> /home/ubuntu/.ssh/authorized_keys
  done < /tmp/ci_key.pub
  chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
  chmod 600 /home/ubuntu/.ssh/authorized_keys
  rm -f /tmp/ci_key.pub
fi

install -d -m 0755 /etc/letsencrypt
install -m 0600 /tmp/cloudflare.ini /etc/letsencrypt/cloudflare.ini
rm -f /tmp/cloudflare.ini

DOMAINS_ARGS=""
for d in $DOMAINS; do DOMAINS_ARGS="$DOMAINS_ARGS -d $d"; done

if [ ! -d "/etc/letsencrypt/live/$PRIMARY_DOMAIN" ]; then
  certbot certonly --non-interactive --agree-tos --email "$ACME_EMAIL" \
    --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 20 $DOMAINS_ARGS
fi

# caddy runs unprivileged; without this it cannot read the cert it is told to serve.
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/caddy.sh <<'HOOK'
#!/bin/sh
setfacl -R -m u:caddy:rX /etc/letsencrypt/live /etc/letsencrypt/archive
systemctl reload caddy
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/caddy.sh
setfacl -R -m u:caddy:rX /etc/letsencrypt/live /etc/letsencrypt/archive

systemctl daemon-reload
systemctl enable --now redis-server
systemctl restart rewriter
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { echo "Caddyfile invalid, not reloading"; exit 1; }
systemctl reload caddy || systemctl restart caddy

sleep 2
systemctl is-active --quiet rewriter || { echo "rewriter failed to start"; journalctl -u rewriter -n 20 --no-pager; exit 1; }
systemctl is-active --quiet caddy    || { echo "caddy failed to start";    journalctl -u caddy    -n 20 --no-pager; exit 1; }
echo "apply ok: rewriter=$(systemctl is-active rewriter) caddy=$(systemctl is-active caddy)"
