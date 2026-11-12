#!/usr/bin/env bash
# Private-beta gate in front of the public host, run as `deploy` on the server:
#   ./beta-gate.sh on [user]   create or rotate the login (new password + gate cookie)
#   ./beta-gate.sh off         remove the gate
# Basic auth (bcrypt, cost 12) guards every page. The dashboard sends `Authorization: Bearer`
# to /api, so Basic auth cannot ride along there; instead a successful Basic login sets an
# HttpOnly gate cookie and /api requires it. Left public: Meta webhooks (the webhook app
# verifies X-Hub-Signature-256), the Meta OAuth callbacks (state-checked by the API), /media
# (product pictures Meta downloads) and the website chat widget: /widget.js and its public API,
# called from customer sites without the gate cookie (site key, allowed domains and a signed
# visitor token are checked by the API), Meta's data deletion status page (`/data-deletion`, its
# `/assets` and its status read; the callback itself is under /webhooks), and the privacy and terms pages with the marketing
# assets they load (/static, /fonts, /images), which Google links from its sign-in screen. The
# hash lives in the Nginx Proxy Manager data volume, the gate token in the NPM proxy host config;
# nothing secret goes to Git.
# The new credentials are written to ~/beta-access.txt (mode 600) for the owner.
set -euo pipefail

mode=${1:?usage: beta-gate.sh on [user] | off}
user=${2:-rapiz}
host=$(grep -E '^PUBLIC_HOST=' "$(dirname "$0")/.env" | cut -d= -f2)
npm=${NPM_CONTAINER:-infra-proxy-npm-1}
api=http://127.0.0.1:81/api
creds=~/npm-admin.txt

email=$(sed -n 's/^Email: //p' "$creds")
secret=$(sed -n 's/^Password: //p' "$creds")
token=$(curl -fsS -X POST "$api/tokens" -H 'content-type: application/json' \
  -d "$(jq -n --arg i "$email" --arg s "$secret" '{identity:$i,secret:$s}')" | jq -r .token)
auth=(-H "authorization: Bearer $token" -H 'content-type: application/json')
id=$(curl -fsS "$api/nginx/proxy-hosts" "${auth[@]}" |
  jq -r --arg h "$host" '.[] | select(.domain_names | index($h)) | .id')
[[ -n $id ]] || { echo "no NPM proxy host for $host" >&2; exit 1; }

base='client_max_body_size 50m;
proxy_read_timeout 120s;'

if [[ $mode == off ]]; then
  config=$base
else
  pass=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  gate=$(openssl rand -hex 32)
  printf '%s\n' "$pass" | docker exec -i "$npm" sh -c \
    "mkdir -p /data/rapiz-beta && htpasswd -niB -C 12 '$user' > /data/rapiz-beta/htpasswd.new &&
     chmod 644 /data/rapiz-beta/htpasswd.new && mv /data/rapiz-beta/htpasswd.new /data/rapiz-beta/htpasswd"
  config="$base

# Rapiz private-beta gate (infra/deploy/beta-gate.sh). Rotate with ./beta-gate.sh on.
set \$rapiz_gate \"$gate\";

location /webhooks/ {
  include conf.d/include/proxy.conf;
}
# Privacy policy and terms: Google shows them on its sign-in screen, so they must stay public.
location ~ ^/(privacy|terms)(/.*)?\$ {
  include conf.d/include/proxy.conf;
}
location ~ ^/(static|fonts|images)/ {
  include conf.d/include/proxy.conf;
}
location /media/ {
  include conf.d/include/proxy.conf;
  # Browsers resend the Basic credentials; the bucket would read them as a bad S3 signature.
  proxy_set_header Authorization \"\";
}
location ~ ^/api(/v1)?/channels/oauth/[^/]+/callback\$ {
  include conf.d/include/proxy.conf;
}
location = /widget.js {
  include conf.d/include/proxy.conf;
}
location /api/v1/webchat/v1/sites/ {
  include conf.d/include/proxy.conf;
}
# Meta's data deletion status page (the URL our callback returns) and the public status read it
# makes; the page is the dashboard bundle, so its hashed /assets must load without the gate too.
location = /data-deletion {
  include conf.d/include/proxy.conf;
}
location /assets/ {
  include conf.d/include/proxy.conf;
}
location ~ ^/api(/v1)?/meta/data-deletion/[^/]+\$ {
  include conf.d/include/proxy.conf;
}
location /api/ {
  if (\$cookie_rapiz_beta != \$rapiz_gate) {
    return 401;
  }
  include conf.d/include/proxy.conf;
}
location / {
  # bcrypt (cost 12) costs ~0.25 s of CPU per request; once the gate cookie is valid, skip it.
  set \$rapiz_realm \"Rapiz private beta\";
  if (\$cookie_rapiz_beta = \$rapiz_gate) {
    set \$rapiz_realm off;
  }
  auth_basic \$rapiz_realm;
  auth_basic_user_file /data/rapiz-beta/htpasswd;
  add_header Set-Cookie \"rapiz_beta=\$rapiz_gate; Path=/; Max-Age=604800; Secure; HttpOnly; SameSite=Lax\";
  include conf.d/include/proxy.conf;
}"
fi

curl -fsS -X PUT "$api/nginx/proxy-hosts/$id" "${auth[@]}" \
  -d "$(jq -n --arg c "$config" '{advanced_config:$c}')" >/dev/null
docker exec "$npm" nginx -t 2>&1 | tail -1

if [[ $mode == on ]]; then
  umask 077
  printf 'Rapiz private beta (https://%s)\nUser: %s\nPassword: %s\n' "$host" "$user" "$pass" > ~/beta-access.txt
  echo "gate on for $host; credentials in ~/beta-access.txt"
else
  echo "gate off for $host"
fi
