#!/usr/bin/env bash
# Nightly off-site backup (ADR-028; cron 19:00 UTC = 02:00 Vietnam): WAL-G base backup and
# retention (30 full backups = 30 days of point-in-time recovery), encrypted media sync, encrypted
# config, pruning. Every step runs even if an earlier one failed; each result is recorded for
# backup-check.sh. Exits 1 if any step failed. Restore: docs/runbooks/backup-and-restore.md.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
. ./backup-lib.sh
configured || { log "backup: off-site not configured"; exit 0; }
backup_lock
trim_logs
failed=0
step() {
  local name=$1
  shift
  if "$@"; then
    status_set "${name}_ok"
    log "$name: ok"
  else
    status_set "${name}_failed"
    log "$name: FAILED"
    failed=1
  fi
}
step base compose exec -T -u postgres postgres wal-g backup-push /var/lib/postgresql/data
step retain compose exec -T -u postgres postgres wal-g delete retain FULL 30 --confirm
step media compose run --rm -T backup media
step config compose run --rm -T backup config
step prune compose run --rm -T backup prune
exit "$failed"
