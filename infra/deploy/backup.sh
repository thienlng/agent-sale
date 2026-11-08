#!/usr/bin/env bash
# Local database dump into /opt/apps/rapiz/backups (cron daily, and by deploy.sh before each deploy).
# Keeps 7 days once off-site backups are configured, 14 days until then.
# It does not survive losing the server: off-site, point-in-time backups are backup-nightly.sh and
# WAL archiving (ADR-028). Restore: docs/runbooks/backup-and-restore.md.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
keep=14
if configured; then keep=7; fi
file=backups/rapiz-$(date -u +%Y%m%dT%H%M%SZ).dump
compose exec -T postgres pg_dump -U rapiz_owner -d rapiz -Fc > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'rapiz-*.dump' -mtime "+$keep" -delete
echo "$(date -u +%FT%TZ) wrote $file ($(du -h "$file" | cut -f1))"
