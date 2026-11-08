#!/usr/bin/env bash
# Local database dump into /opt/apps/rapiz/backups (cron daily, and before deploys). Keeps 7 days.
# It does not survive losing the server: off-site, point-in-time backups are backup-nightly.sh and
# WAL archiving (ADR-028). Restore: docs/runbooks/backup-and-restore.md.
set -euo pipefail
cd "$(dirname "$0")"
file=backups/rapiz-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose --env-file .env exec -T postgres pg_dump -U rapiz_owner -d rapiz -Fc > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'rapiz-*.dump' -mtime +7 -delete
echo "$(date -u +%FT%TZ) wrote $file ($(du -h "$file" | cut -f1))"
