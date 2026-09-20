#!/usr/bin/env bash
# Idempotent config apply. Runs on every `terraform apply` whose triggers changed.
set -euo pipefail

# Edge cache. The apt caddy has no HTTP cache module, so we swap in the official
# custom build that bundles caddyserver/cache-handler (souin). Idempotent, and
# deliberately NON-FATAL: this is a ~48MB pull from Moscow and it has timed out
# mid-download before. Losing the cache is a slowdown; refusing to deploy because
# of it is an outage, so on failure we carry on with the stock binary and drop the
# cache directives from the Caddyfile below.
CADDY_BUILD="https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/caddyserver/cache-handler"
has_cache() { /usr/bin/caddy list-modules 2>/dev/null | grep -q '^http.handlers.cache$'; }

if ! has_cache; then
  echo "fetching caddy build with cache-handler"
  if curl -fsSL --retry 3 --retry-delay 5 --retry-all-errors -C - --max-time 900 \
       "$CADDY_BUILD" -o /tmp/caddy-cache; then
    chmod +x /tmp/caddy-cache
    # A truncated download would take the proxy down on restart.
    if /tmp/caddy-cache list-modules 2>/dev/null | grep -q '^http.handlers.cache$'; then
      apt-mark hold caddy >/dev/null 2>&1 || true
      install -m 0755 /tmp/caddy-cache /usr/bin/caddy
      setcap cap_net_bind_service=+ep /usr/bin/caddy 2>/dev/null || true
      NEED_CADDY_RESTART=1
    else
      echo "WARNING: downloaded caddy lacks cache-handler, keeping stock binary"
    fi
  else
    echo "WARNING: caddy cache build download failed, continuing without edge cache"
  fi
  rm -f /tmp/caddy-cache
fi

# Serving a Caddyfile with `cache` on a binary that lacks the module is a hard
# config error, i.e. no proxy at all. Strip those lines when unsupported.
if ! has_cache; then
  sed -i '/# >>>CACHE/,/# <<<CACHE/d; /# CACHE-LINE/d' /tmp/Caddyfile
  echo "caddy has no cache module; serving without edge cache"
fi

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

# Certificates are Caddy's own job now (HTTP-01; DNS points here permanently).
# certbot + a Cloudflare token on the box + an ACL to let caddy read /etc/letsencrypt
# were three moving parts that all had to work on a rebuild, and on 2026-09-10 the
# DNS-01 challenge failed and left the proxy with no cert at all.
install -d -m 0755 -o caddy -g caddy /var/lib/caddy

systemctl daemon-reload
systemctl enable --now redis-server
systemctl restart rewriter
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { echo "Caddyfile invalid, not reloading"; exit 1; }
if [ "${NEED_CADDY_RESTART:-0}" = 1 ]; then systemctl restart caddy; else systemctl reload caddy || systemctl restart caddy; fi

sleep 2
systemctl is-active --quiet rewriter || { echo "rewriter failed to start"; journalctl -u rewriter -n 20 --no-pager; exit 1; }
systemctl is-active --quiet caddy    || { echo "caddy failed to start";    journalctl -u caddy    -n 20 --no-pager; exit 1; }
echo "apply ok: rewriter=$(systemctl is-active rewriter) caddy=$(systemctl is-active caddy)"
