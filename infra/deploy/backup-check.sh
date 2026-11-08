#!/usr/bin/env bash
# Backup health check (ADR-028; cron every 5 minutes). Emails BACKUP_ALERT_EMAIL (Resend) when
# off-site backups are off, WAL archiving is stuck or failing, a nightly step or the weekly drill
# failed or is overdue, or the disk is filling. One email per alert per hour (per day for
# not_configured). Alerts: docs/runbooks/backup-and-restore.md#alerts.
# BACKUP_CHECK_DRY_RUN=1 logs the alerts without email; BACKUP_WAL_MAX_AGE (s) is a test hook.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
now=$(date +%s)
alerts=()
add() { alerts+=("$1|$2"); }

if ! configured; then
  add not_configured "Off-site backups are not configured (BACKUP_S3_BUCKET is empty in .env)."
elif ! wal=$(pg_q "select count(*), coalesce(extract(epoch from now() - min(modification))::bigint, 0) from pg_ls_archive_statusdir() where name like '%.ready'" 2>/dev/null) ||
  ! failing=$(pg_q "select coalesce(last_failed_time > coalesce(last_archived_time, '-infinity'), false) from pg_stat_archiver" 2>/dev/null); then
  add db_unreachable "The backup check cannot query Postgres."
else
  IFS='|' read -r ready oldest <<<"$wal"
  if ((oldest > ${BACKUP_WAL_MAX_AGE:-900})); then
    add wal_stuck "$ready WAL segments wait for upload, the oldest for ${oldest}s. Check the off-site bucket; pg_wal grows until uploads work."
  fi
  if [[ $failing == t ]]; then add wal_failing "The last WAL upload failed (docker compose logs postgres)."; fi
  if ((now - $(status_get base_ok) > 26 * 3600)); then add base_stale "No successful base backup for more than 26 hours."; fi
  for s in base retain media config prune; do
    if (($(status_get "${s}_failed") > $(status_get "${s}_ok"))); then
      add "${s}_failed" "Nightly backup step $s failed (backups/offsite.log)."
    fi
  done
  if ((now - $(status_get drill_ok) > 8 * 86400)); then add drill_stale "No successful restore drill for more than 8 days."; fi
  if (($(status_get drill_failed) > $(status_get drill_ok))); then add drill_failed "The last restore drill failed (backups/drills.log)."; fi
fi
root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)
pct=$(df -P "$root" 2>/dev/null | awk 'NR==2{sub("%","",$5); print $5}') || pct=0
if ((${pct:-0} > 85)); then add disk_full "Disk at ${pct}% on $root."; fi
walbytes=$(pg_q "select coalesce(sum(size), 0) from pg_ls_waldir()" 2>/dev/null) || walbytes=0
if ((${walbytes:-0} > 5 * 1024 ** 3)); then add wal_dir_large "pg_wal holds $((walbytes / 1024 ** 2)) MiB."; fi

to=$(env_get BACKUP_ALERT_EMAIL)
host=$(env_get PUBLIC_HOST)
mkdir -p backups/.alerts
for a in "${alerts[@]}"; do
  key=${a%%|*}
  text=${a#*|}
  window=3600
  [[ $key == not_configured ]] && window=86400
  mark=backups/.alerts/$key
  if [[ -f $mark ]] && ((now - $(stat -c %Y "$mark") < window)); then continue; fi
  log "ALERT $key: $text"
  if [[ ${BACKUP_CHECK_DRY_RUN:-} == 1 ]]; then
    touch "$mark"
    continue
  fi
  [[ -n $to ]] || continue
  if send_email "$to" "[Rapiz ${host:-server}] backup alert: $key" "$text See docs/runbooks/backup-and-restore.md."; then
    touch "$mark"
  fi
done
