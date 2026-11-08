#!/usr/bin/env bash
# One-time setup of the app folder, run as the `deploy` user on the server:
#   bash bootstrap.sh <public-host>
# Prerequisites (once, by an admin; docs/runbooks/deploy-vps.md): Docker, `deploy` in the
# `docker` group, /opt/apps/rapiz owned by deploy, and the external Docker network `proxy`
# of the server's Nginx Proxy Manager.
# Copies the server files, writes /opt/apps/rapiz/.env with freshly generated secrets (an
# existing file is never overwritten) and installs the backup cron lines (ADR-028). Off-site
# backups start once ./backup-keys.sh has run and BACKUP_S3_* are filled in .env
# (docs/runbooks/backup-and-restore.md).
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
  for f in deploy.sh backup.sh set-host.sh beta-gate.sh backup-lib.sh backup-nightly.sh backup-check.sh \
    restore-drill.sh backup-keys.sh; do install -m 755 "$HERE/$f" "$DIR/$f"; done
  rm -rf "$DIR/postgres" && cp -r "$HERE/postgres" "$DIR/postgres"
fi

if [[ ! -f $DIR/.env ]]; then
  pw() { openssl rand -hex 24; }
  pem() { awk '{printf "%s\\n", $0}'; }
  key=$(mktemp)
  openssl genpkey -algorithm ed25519 -out "$key"
  owner=$(pw) tenant=$(pw) system=$(pw) assistant=$(pw)
  umask 077
  cat > "$DIR/.env" <<ENV
# Rapiz production environment. Secrets: never commit, never paste into chat or logs.
PUBLIC_HOST=$HOST
LOG_LEVEL=info

POSTGRES_OWNER_PASSWORD=$owner
DATABASE_OWNER_URL=postgres://rapiz_owner:$owner@postgres:5432/rapiz
DATABASE_URL=postgres://rapiz_tenant:$tenant@postgres:5432/rapiz
DATABASE_SYSTEM_URL=postgres://rapiz_system:$system@postgres:5432/rapiz
# Read-only SQL lane of the owner assistant (T-171); unset = lane off.
DATABASE_ASSISTANT_SQL_URL=postgres://rapiz_assistant:$assistant@postgres:5432/rapiz
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

# Signup and password codes (ADR-023) and notification emails (T-172). Without it no email is
# sent and signup cannot finish.
# RESEND_API_KEY=
EMAIL_FROM="Rapiz <noreply@rapiz.io>"
ENV
  rm -f "$key"
  echo "wrote $DIR/.env"
else
  echo "$DIR/.env exists; left unchanged"
fi

# Local dump, off-site backup, health check and restore drill (backup-lib.sh, ADR-028).
(cd "$DIR" && . ./backup-lib.sh && install_backup_cron "$DIR")
echo "bootstrap done; next: ./backup-keys.sh, store the kit, fill BACKUP_* in .env (docs/runbooks/backup-and-restore.md)"
