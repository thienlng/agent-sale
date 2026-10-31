#!/usr/bin/env bash
# One-time server setup on a fresh Ubuntu 24.04 host, run as root:
#   bash bootstrap.sh <public-host> <acme-email> [ci-public-key-file]
# Installs Docker if missing, opens only SSH/HTTP/HTTPS, creates the `deploy` user that CI
# logs in as, and writes /opt/rapiz/.env with freshly generated secrets (never overwritten).
# Safe to re-run. See docs/runbooks/deploy-vps.md.
set -euo pipefail

HOST=${1:?usage: bootstrap.sh <public-host> <acme-email> [ci-public-key-file]}
EMAIL=${2:?usage: bootstrap.sh <public-host> <acme-email> [ci-public-key-file]}
CI_KEY=${3:-}
DIR=/opt/rapiz
HERE=$(cd "$(dirname "$0")" && pwd)

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

apt-get install -y -qq ufw openssl >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [[ -n $CI_KEY ]]; then
  touch /home/deploy/.ssh/authorized_keys
  grep -qxF "$(cat "$CI_KEY")" /home/deploy/.ssh/authorized_keys || cat "$CI_KEY" >> /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys
fi

install -d -m 750 -o deploy -g deploy "$DIR" "$DIR/backups"
for f in compose.yml deploy.sh backup.sh set-host.sh; do
  install -m 755 -o deploy -g deploy "$HERE/$f" "$DIR/$f"
done
chmod 644 "$DIR/compose.yml"

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
ACME_EMAIL=$EMAIL
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
  chown deploy:deploy "$DIR/.env"
  echo "wrote $DIR/.env"
else
  echo "$DIR/.env exists; left unchanged"
fi

# Daily database backup at 03:15, 14 days kept (see backup.sh).
echo "15 3 * * * deploy $DIR/backup.sh >> $DIR/backups/backup.log 2>&1" > /etc/cron.d/rapiz-backup
echo "bootstrap done"
