#!/usr/bin/env bash
# Generates the off-site backup keys once (ADR-028), adds every missing BACKUP_* line to .env and
# prints the break-glass kit a single time. Store the kit outside the server (password manager):
# without it the off-site backups cannot be read. Never changes an existing key.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
if [[ -n $(env_get BACKUP_WALG_KEY) ]]; then
  echo "backup keys already in .env; nothing to do"
  exit 0
fi
docker image inspect rapiz-postgres:local >/dev/null 2>&1 || compose build -q postgres
walg=$(openssl rand -base64 32)
pass=$(openssl rand -hex 24)
salt=$(openssl rand -hex 24)
agekey=$(docker run --rm --entrypoint age-keygen rapiz-postgres:local 2>/dev/null)
recipient=$(sed -n 's/^# public key: //p' <<<"$agekey")
[[ $recipient == age1* ]] || { echo "age-keygen failed" >&2; exit 1; }
umask 077
add() { grep -qE "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env; }
printf '\n# Off-site backups (ADR-028, docs/runbooks/backup-and-restore.md). The age private key is not here.\n' >> .env
sed -i -E '/^BACKUP_(WALG_KEY|RCLONE_PASSWORD|RCLONE_SALT|AGE_RECIPIENT)=$/d' .env
for k in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY BACKUP_ALERT_EMAIL; do add "$k" ''; done
add BACKUP_S3_REGION auto
add BACKUP_WALG_KEY "$walg"
add BACKUP_RCLONE_PASSWORD "$pass"
add BACKUP_RCLONE_SALT "$salt"
add BACKUP_AGE_RECIPIENT "$recipient"
cat <<KIT
===== RAPIZ BREAK-GLASS KIT: store it in a password manager now; it is not shown again =====
BACKUP_WALG_KEY=$walg
BACKUP_RCLONE_PASSWORD=$pass
BACKUP_RCLONE_SALT=$salt
$agekey
Also store the BACKUP_S3_* values from .env.
=============================================================================================
KIT
