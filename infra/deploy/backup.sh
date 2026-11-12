#!/usr/bin/env bash
# Local database dump into /opt/apps/rapiz/backups (cron daily, and by deploy.sh before each deploy).
# Keeps 7 days once off-site backups are configured, 14 days until then.
# It does not survive losing the server: off-site, point-in-time backups are backup-nightly.sh and
# WAL archiving (ADR-028). Restore: docs/runbooks/backup-and-restore.md.
# With BACKUP_AGE_RECIPIENT in .env the dump is encrypted to that age key (rapiz-*.dump.age, the
# private key stays off the server), so a copied backups folder does not leak the database.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
keep=14
if configured; then keep=7; fi
file=backups/rapiz-$(date -u +%Y%m%dT%H%M%SZ).dump
recipient=$(env_get BACKUP_AGE_RECIPIENT)
mkdir -p backups
if [[ -n $recipient ]]; then
  file+=.age
  # age runs in the postgres image (it ships the backup tools); the recipient is a public key.
  compose exec -T postgres pg_dump -U rapiz_owner -d rapiz -Fc |
    compose exec -T postgres age -r "$recipient" > "$file.tmp"
else
  echo "$(date -u +%FT%TZ) warning: BACKUP_AGE_RECIPIENT is not set; the local dump is not encrypted" >&2
  compose exec -T postgres pg_dump -U rapiz_owner -d rapiz -Fc > "$file.tmp"
fi
chmod 600 "$file.tmp"
mv "$file.tmp" "$file"
find backups \( -name 'rapiz-*.dump' -o -name 'rapiz-*.dump.age' \) -mtime "+$keep" -delete
echo "$(date -u +%FT%TZ) wrote $file ($(du -h "$file" | cut -f1))"
