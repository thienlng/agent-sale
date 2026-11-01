#!/usr/bin/env bash
# Moves the stack to another domain, e.g. ./set-host.sh rapiz.io
# First point the domain's DNS A record at this server and add it to the rapiz-edge proxy host
# in Nginx Proxy Manager (with a Let's Encrypt certificate). Afterwards update the Meta app
# (webhook URL, OAuth redirect URIs, app domains).
set -euo pipefail
cd "$(dirname "$0")"
new=${1:?usage: set-host.sh <new-host>}
old=$(grep -E '^PUBLIC_HOST=' .env | cut -d= -f2)
[[ $old != "$new" ]] || { echo "already $new"; exit 0; }
cp .env ".env.bak.$(date +%s)"
sed -i "s#^PUBLIC_HOST=.*#PUBLIC_HOST=$new#; s#https://$old#https://$new#g" .env
RAPIZ_TAG=$(cat .deployed-tag) docker compose --env-file .env up -d --wait
echo "now serving https://$new (was $old)"
