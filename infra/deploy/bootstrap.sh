#!/usr/bin/env bash
# One-time setup of the app folder, run as the `deploy` user on the server:
#   bash bootstrap.sh <public-host>
# Prerequisites (once, by an admin; docs/runbooks/deploy-vps.md): Docker, `deploy` in the
# `docker` group, /opt/apps/rapiz owned by deploy, and the external Docker network `proxy`
# of the server's Nginx Proxy Manager.
# Copies the server files, writes /opt/apps/rapiz/.env with freshly generated secrets (an
# existing file is never overwritten) and installs the daily backup in deploy's crontab.
set -euo pipefail

HOST=${1:?usage: bootstrap.sh <public-host>}
DIR=${RAPIZ_DIR:-/opt/apps/rapiz}
HERE=$(cd "$(dirname "$0")" && pwd)

docker info >/dev/null 2>&1 || { echo "this user cannot use Docker (add it to the docker group)" >&2; exit 1; }
[[ -w $DIR ]] || { echo "$DIR must exist and be writable by $(id -un)" >&2; exit 1; }
docker network inspect proxy >/dev/null 2>&1 || { echo "external Docker network 'proxy' is missing" >&2; exit 1; }

mkdir -p "$DIR/backups"
chmod 750 "$DIR" "$DIR/backups"
if [[ $HERE != "$DIR" ]]; then
  install -m 644 "$HERE/compose.yml" "$DIR/compose.yml"
  for f in deploy.sh backup.sh set-host.sh; do install -m 755 "$HERE/$f" "$DIR/$f"; done
fi

if [[ ! -f $DIR/.env ]]; then
  pw() { openssl rand -hex 24; }
  pem() { awk '{printf "%s\\n", $0}'; }
  key=$(mktemp)
  openssl genpkey -algorithm ed25519 -out "$key"
  owner=$(pw) tenant=$(pw) system=$(pw)
  umask 077
  cat > "$DIR/.env" <<ENV
# Rapiz production environment. Secrets: never commit, never paste into chat or logs.
PUBLIC_HOST=$HOST
LOG_LEVEL=info

POSTGRES_OWNER_PASSWORD=$owner
DATABASE_OWNER_URL=postgres://rapiz_owner:$owner@postgres:5432/rapiz
DATABASE_URL=postgres://rapiz_tenant:$tenant@postgres:5432/rapiz
DATABASE_SYSTEM_URL=postgres://rapiz_system:$system@postgres:5432/rapiz
REDIS_URL=redis://redis:6379

S3_ENDPOINT=http://object-storage:8333
S3_BUCKET=rapiz
S3_ACCESS_KEY=rapiz
S3_SECRET_KEY=$(pw)
S3_PUBLIC_URL=https://$HOST/media

APP_ORIGINS=https://$HOST
COOKIE_SECURE=true
SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)
JWT_KEY_ID=k1
JWT_PRIVATE_KEY=$(pem < "$key")
JWT_PUBLIC_KEY=$(openssl pkey -in "$key" -pubout | pem)

# Meta (Facebook/Instagram). Fill in, then run ./deploy.sh again.
META_APP_ORIGIN=https://$HOST
# META_APP_ID=
# META_APP_SECRET=
# META_LOGIN_CONFIG_ID=
# INSTAGRAM_APP_ID=
# INSTAGRAM_APP_SECRET=
# META_WEBHOOK_VERIFY_TOKEN=
# SMTP_URL=
ENV
  rm -f "$key"
  echo "wrote $DIR/.env"
else
  echo "$DIR/.env exists; left unchanged"
fi

# Daily database backup at 03:15 server time, 14 days kept (see backup.sh).
line="15 3 * * * $DIR/backup.sh >> $DIR/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF "$DIR/backup.sh"; echo "$line" ) | crontab -
echo "bootstrap done"
