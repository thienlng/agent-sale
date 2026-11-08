#!/usr/bin/env bash
# Weekly restore drill (ADR-028; cron Sunday 21:00 UTC). Restores the newest off-site base backup
# plus archived WAL into the throwaway `pgdrill` container, compares row counts and the newest row
# time with production, checks 20 media objects and the newest config archive, records the result
# (stdout → backups/drills.log, status drill_ok/drill_failed, off-site drills/<date>.json) and
# removes the container and its volume. The duration is the real database restore time (RTO).
# Test hooks: DRILL_TABLES, DRILL_FRESHNESS (<table>.<column>), DRILL_TIMEOUT (seconds).
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
configured || { log "drill: off-site not configured"; exit 0; }
backup_lock
tables=${DRILL_TABLES:-workspaces conversations conversation_messages orders contacts}
fresh=${DRILL_FRESHNESS:-conversation_messages.created_at}
timeout=${DRILL_TIMEOUT:-3600}
vol="$(project)_pgdrill"
started=$(date +%s)
cleanup() {
  compose rm -sf pgdrill >/dev/null 2>&1 || true
  docker volume rm -f "$vol" >/dev/null 2>&1 || true
}
fail() {
  log "drill FAILED: $*"
  status_set drill_failed
  exit 1
}
if [[ -n $(compose ps -aq pgdrill 2>/dev/null) ]]; then
  log "drill: skipped, pgdrill is in use (a manual restore?); remove it when done"
  exit 0
fi
trap cleanup EXIT

db_bytes=$(pg_q "select pg_database_size('rapiz')")
root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)
free=$(df -P -B1 "$root" 2>/dev/null | awk 'NR==2{print $4}') || free=$(df -P -B1 / | awk 'NR==2{print $4}')
((free > 2 * db_bytes)) || fail "not enough free disk ($free bytes) to restore $db_bytes bytes"

query="select concat_ws(' '"
for t in $tables; do query+=", (select count(*) from $t)"; done
query+=", coalesce((select extract(epoch from max(${fresh#*.}))::bigint from ${fresh%%.*}), 0))"

cleanup
compose up -d pgdrill >/dev/null 2>&1 || fail "cannot start the restore container"
deadline=$(($(date +%s) + timeout))
until [[ $(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc 'select not pg_is_in_recovery()' 2>/dev/null) == t ]]; do
  (($(date +%s) < deadline)) || fail "restore did not finish in ${timeout}s"
  [[ $(docker inspect -f '{{.State.Running}}' "$(compose ps -aq pgdrill)" 2>/dev/null) == true ]] ||
    fail "restore container stopped: $(compose logs --tail 5 pgdrill 2>&1 | tr '\n' ' ')"
  sleep 5
done
prod_out=$(pg_q "$query") || fail "cannot query production"
drill_out=$(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc "$query") || fail "cannot query the restored copy"
read -r -a prod <<<"$prod_out"
read -r -a drill <<<"$drill_out"
i=0
for t in $tables; do
  ((drill[i] * 100 >= prod[i] * 99)) || fail "$t: restored ${drill[i]} rows, production has ${prod[i]}"
  i=$((i + 1))
done
((prod[i] - drill[i] <= 900)) || fail "newest $fresh is $((prod[i] - drill[i]))s behind production"
compose run --rm -T backup verify 20 >/dev/null || fail "media or config check failed"

secs=$(($(date +%s) - started))
status_set drill_ok
log "drill ok ${secs}s tables=$(tr ' ' ',' <<<"$tables") rows=$(tr ' ' ',' <<<"${drill[*]}")"
printf '{"ok":true,"seconds":%d,"at":"%s"}\n' "$secs" "$(date -u +%FT%TZ)" |
  compose run --rm -T backup rclone rcat "offsite:$(env_get BACKUP_S3_BUCKET)/drills/$(date -u +%F).json" || true
