# Helpers for the backup scripts (ADR-028); sourced with the app folder as working directory.
# shellcheck shell=bash
compose() { docker compose --env-file .env "$@"; }
env_get() {
  local v
  v=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-) || true
  v=${v%\"}
  v=${v#\"}
  printf '%s' "$v"
}
configured() { [[ -n $(env_get BACKUP_S3_BUCKET) ]]; }
project() { printf '%s' "${COMPOSE_PROJECT_NAME:-rapiz}"; }
log() { echo "$(date -u +%FT%TZ) $*"; }
pg_q() { compose exec -T postgres psql -U rapiz_owner -d rapiz -Atc "$1"; }

# Last success/failure time of each step, one `key=epoch` line per key (read by backup-check.sh).
BACKUP_STATUS=backups/backup-status
status_set() {
  mkdir -p backups
  touch "$BACKUP_STATUS"
  { grep -v "^$1=" "$BACKUP_STATUS" || true; echo "$1=$(date +%s)"; } > "$BACKUP_STATUS.tmp"
  mv "$BACKUP_STATUS.tmp" "$BACKUP_STATUS"
}
status_get() {
  local v
  v=$(grep -E "^$1=" "$BACKUP_STATUS" 2>/dev/null | cut -d= -f2) || true
  echo "${v:-0}"
}

# send_email <to> <subject> <text>: Resend HTTP API (key of ADR-023). Text must not contain quotes.
send_email() {
  local key
  key=$(env_get RESEND_API_KEY)
  [[ -n $key ]] || { log "send_email: RESEND_API_KEY is not set"; return 1; }
  curl -fsS -m 20 https://api.resend.com/emails \
    -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
    -d "$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' "$(env_get EMAIL_FROM)" "$1" "$2" "$3")" >/dev/null
}

# install_backup_cron <app dir>: idempotent crontab lines for every backup script (server clock UTC).
install_backup_cron() {
  local dir=$1 entry script when logf current
  current=$(crontab -l 2>/dev/null || true)
  for entry in 'backup.sh|15 3 * * *|backup.log' 'backup-nightly.sh|0 19 * * *|offsite.log' \
    'backup-check.sh|*/5 * * * *|check.log' 'restore-drill.sh|0 21 * * 0|drills.log'; do
    IFS='|' read -r script when logf <<<"$entry"
    current=$(grep -vF "$dir/$script" <<<"$current" || true)
    current+=$'\n'"$when $dir/$script >> $dir/backups/$logf 2>&1"
  done
  sed '/^$/d' <<<"$current" | crontab -
}
