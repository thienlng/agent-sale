#!/usr/bin/env bash
# Database dump into /opt/apps/rapiz/backups (cron, daily). Keeps 14 days. Copy the dumps off the
# server too: a backup on the same disk does not survive losing the server.
# Restore: docs/runbooks/deploy-vps.md#restore.
set -euo pipefail
cd "$(dirname "$0")"
file=backups/rapiz-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose --env-file .env exec -T postgres pg_dump -U rapiz_owner -d rapiz -Fc > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'rapiz-*.dump' -mtime +14 -delete
echo "$(date -u +%FT%TZ) wrote $file ($(du -h "$file" | cut -f1))"
