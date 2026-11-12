#!/usr/bin/env bash
# Checks the security headers and routes of the edge Caddyfile (docs/09-security-and-compliance.md
# §6): validates the config, then runs it unprivileged in the pinned Caddy image with stub web/site
# folders and stub api / object-storage upstreams on a private Docker network. Needs Docker.
# Usage: bash infra/deploy/test/edge-headers.sh
set -euo pipefail
src=$(cd "$(dirname "$0")/.." && pwd)
caddy_image=$(sed -nE 's/^FROM (caddy:[^ ]+) AS edge$/\1/p' "$src/Dockerfile")
[[ -n $caddy_image ]] || { echo "FAIL - no edge stage in the Dockerfile" >&2; exit 1; }
run_id=edgetest-$$
net=$run_id
work=$(mktemp -d)
chmod 755 "$work"
teardown() {
  docker rm -f "$run_id-edge" "$run_id-api" "$run_id-s3" > /dev/null 2>&1 || true
  docker network rm "$net" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap teardown EXIT
fail() {
  echo "FAIL - $*" >&2
  exit 1
}
ok() { echo "ok - $*"; }

mkdir -p "$work/web/assets" "$work/site" "$work/widget" "$work/stub"
echo '<!doctype html><title>dashboard</title>' > "$work/web/index.html"
echo 'boot' > "$work/web/boot.js"
echo '<!doctype html><title>site</title>' > "$work/site/index.html"
echo 'widget' > "$work/widget/widget.js"
# Upstream stubs: the api answers everything; object storage claims every file renders inline.
cat > "$work/stub/Caddyfile" << 'EOF'
{
	auto_https off
}
:3000 {
	respond "api {path}" 200
}
:8333 {
	header Content-Disposition inline
	header Content-Type text/html
	respond "<script>alert(1)</script>" 200
}
EOF
chmod -R a+rX "$work"

docker run --rm -e S3_BUCKET=rapiz -v "$src/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy_image" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 ||
  fail "caddy validate rejected the Caddyfile"
ok "caddy validate"

docker network create "$net" > /dev/null
stub() {
  docker run -d --name "$run_id-$1" --network "$net" --network-alias "$2" \
    -v "$work/stub/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy_image" > /dev/null
}
stub api api
stub s3 object-storage
# Same user, directories and environment as the edge image (Dockerfile `edge` stage).
docker run -d --name "$run_id-edge" --network "$net" --user 10002:10002 \
  -e S3_BUCKET=rapiz -e XDG_DATA_HOME=/tmp/caddy/data -e XDG_CONFIG_HOME=/tmp/caddy/config \
  -v "$src/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$work/web:/srv/web:ro" \
  -v "$work/site:/srv/site:ro" -v "$work/widget:/srv/widget:ro" "$caddy_image" > /dev/null

# fetch <path>: status line and headers, fetched from inside the network.
fetch() {
  docker run --rm --network "$net" "$caddy_image" \
    wget -S -q -O /dev/null "http://$run_id-edge$1" 2>&1 || true
}
for _ in $(seq 1 30); do
  fetch / | grep -q 'HTTP/' && break
  sleep 1
done

expect() { grep -qiF -- "$2" <<< "$1" || fail "$3: missing '$2' in:"$'\n'"$1"; }
reject() { ! grep -qiF -- "$2" <<< "$1" || fail "$3: unexpected '$2' in:"$'\n'"$1"; }

out=$(fetch /)
expect "$out" 'HTTP/1.1 200' 'site'
expect "$out" "Content-Security-Policy: default-src 'self'; script-src 'self'" 'site CSP enforced'
expect "$out" 'X-Frame-Options: DENY' 'site'
expect "$out" 'Permissions-Policy: camera=()' 'site'
expect "$out" 'Strict-Transport-Security: max-age=31536000' 'site'
reject "$out" 'includeSubDomains' 'site HSTS'
reject "$out" 'Server: Caddy' 'site'
ok "marketing site: enforced CSP, frame and feature lockdown, HSTS"

out=$(fetch /inbox)
expect "$out" 'HTTP/1.1 200' 'dashboard'
expect "$out" "Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'" 'dashboard'
expect "$out" "Content-Security-Policy: frame-ancestors 'none'" 'dashboard enforced framing'
expect "$out" 'X-Frame-Options: DENY' 'dashboard'
out=$(fetch /boot.js)
expect "$out" 'Cache-Control: no-cache' 'boot script'
ok "dashboard: report-only CSP plus enforced frame-ancestors"

out=$(fetch /widget.js)
expect "$out" 'HTTP/1.1 200' 'widget'
reject "$out" 'Cross-Origin-Resource-Policy' 'widget must load on any site'
ok "widget script stays loadable from other sites"

out=$(fetch /media/p/photo.png)
expect "$out" 'Content-Security-Policy: sandbox;' 'media picture'
reject "$out" 'Content-Disposition' 'media picture renders inline'
out=$(fetch /media/p/page.html)
expect "$out" 'Content-Security-Policy: sandbox;' 'media document'
expect "$out" 'Content-Disposition: attachment' 'media document downloads'
reject "$out" 'Content-Disposition: inline' 'media upstream disposition'
ok "media: sandboxed, non-pictures download"

out=$(fetch /api/v1/health/ready)
expect "$out" 'HTTP/1.1 404' 'readiness'
out=$(fetch /api/v1/health)
expect "$out" 'HTTP/1.1 200' 'health'
ok "readiness stays internal, health is public"

docker exec "$run_id-edge" id -u | grep -qx 10002 || fail "edge runs as root"
ok "edge runs unprivileged"
