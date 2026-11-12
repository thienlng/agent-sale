#!/usr/bin/env bash
# End-to-end test of the off-site backups (ADR-028). Needs Docker and network access (it builds
# the postgres image). Runs the real compose file and scripts in project rapiz-bktest, with a
# second SeaweedFS as the off-site bucket, then removes everything.
# Usage: bash infra/deploy/test/backup-e2e.sh
# shellcheck disable=SC2016 # waitfor evaluates its single-quoted condition later
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=$(dirname "$here")
work=$(mktemp -d)
export COMPOSE_PROJECT_NAME=rapiz-bktest
# compose.yml requires an image tag; the backup services never use the app or edge images.
export RAPIZ_TAG=bktest
cd "$work"
cp "$src"/{compose.yml,backup.sh,backup-lib.sh,backup-nightly.sh,backup-check.sh,restore-drill.sh,backup-keys.sh} .
cp -r "$src/postgres" .
cp "$here/compose.override.yml" .
compose() { docker compose --env-file .env "$@"; }
ok() { echo "ok - $*"; }
die() {
  echo "FAIL - $*" >&2
  exit 1
}
teardown() {
  compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap teardown EXIT
psqlq() { compose exec -T postgres psql -U rapiz_owner -d rapiz -Atc "$1"; }
# Creating a bucket that exists (SeaweedFS makes one on first write) is fine.
mkbucket() { compose exec -T "$1" sh -c "echo 's3.bucket.create -name $2' | weed shell" >/dev/null 2>&1 || true; }
waitfor() {
  local _
  for _ in $(seq 1 "${2:-60}"); do
    if eval "$1"; then return 0; fi
    sleep 2
  done
  die "timeout: $1"
}
ready_wal() { psqlq "select count(*) from pg_ls_archive_statusdir() where name like '%.ready'"; }
bk() { compose run --rm -T backup "$@"; }

cat > .env <<'ENV'
PUBLIC_HOST=bktest.local
POSTGRES_OWNER_PASSWORD=test
S3_ENDPOINT=http://object-storage:8333
S3_BUCKET=rapiz
S3_ACCESS_KEY=rapiz
S3_SECRET_KEY=testsecret
EMAIL_FROM="Rapiz <noreply@example.test>"
BACKUP_S3_ENDPOINT=http://offsite:8333
BACKUP_S3_REGION=us-east-1
BACKUP_S3_BUCKET=offsite-test
BACKUP_S3_ACCESS_KEY=offsite
BACKUP_S3_SECRET_KEY=offsitesecret
ENV
mkdir -p backups

# Keys and kit -----------------------------------------------------------------------------------
compose build -q postgres
kit=$(bash ./backup-keys.sh) || die "backup-keys failed"
grep -q 'AGE-SECRET-KEY-' <<<"$kit" || die "kit has no age private key"
grep -q '^BACKUP_AGE_RECIPIENT=age1' .env || die "no age recipient in .env"
grep -q 'AGE-SECRET-KEY-' .env && die "age private key written to .env"
[[ $(grep -c '^BACKUP_S3_BUCKET=' .env) == 1 ]] || die "existing BACKUP_S3_BUCKET duplicated"
[[ $(bash ./backup-keys.sh) == *"nothing to do"* ]] || die "backup-keys not idempotent"
ok "keys: generated once, kit printed, private key kept off the server"

# WAL archiving ----------------------------------------------------------------------------------
compose up -d --wait postgres object-storage offsite >/dev/null 2>&1
waitfor "compose exec -T offsite sh -c 'echo s3.bucket.list | weed shell' >/dev/null 2>&1"
mkbucket offsite offsite-test
mkbucket object-storage rapiz
psqlq "create table t(id serial, at timestamptz default clock_timestamp(), note text); insert into t(note) values ('before')" >/dev/null
psqlq "select pg_switch_wal()" >/dev/null
waitfor '[[ $(ready_wal) == 0 ]]'
[[ $(psqlq "select archived_count > 0 and failed_count = 0 from pg_stat_archiver") == t ]] || die "WAL not archived"
ok "WAL is archived off-site"

# Nightly ----------------------------------------------------------------------------------------
printf 'one' | bk rclone rcat src:rapiz/a.jpg
printf 'two' | bk rclone rcat src:rapiz/p/b.jpg
bash ./backup-nightly.sh > backups/offsite.log 2>&1 || { cat backups/offsite.log; die "nightly failed"; }
grep -q '^base_ok=' backups/backup-status || die "base_ok not recorded"
compose exec -T -u postgres postgres wal-g backup-list 2>/dev/null | grep -q base_ || die "no base backup"
[[ $(bk rclone cat media:current/a.jpg) == one ]] || die "media not copied"
bk rclone lsf -R offsite:offsite-test/media | grep -q 'a.jpg' && die "media names not encrypted"
bk rclone deletefile src:rapiz/a.jpg
bash ./backup-nightly.sh >> backups/offsite.log 2>&1 || { cat backups/offsite.log; die "second nightly failed"; }
bk rclone lsf -R media:deleted | grep -q 'a.jpg' || die "deleted object not kept"
bk rclone lsf -R media:current | grep -q 'a.jpg' && die "deleted object still current"
age_key=$(grep 'AGE-SECRET-KEY-' <<<"$kit")
newest=$(bk rclone lsf offsite:offsite-test/config | sort | tail -1)
bk rclone cat "offsite:offsite-test/config/$newest" |
  docker run --rm -i -e K="$age_key" --entrypoint sh rapiz-postgres:local -c 'printf "%s\n" "$K" > /tmp/k; age -d -i /tmp/k | tar -xzO .env' |
  grep -q '^BACKUP_S3_BUCKET=offsite-test' || die "config archive does not decrypt"
ok "nightly: base backup, encrypted media sync keeping deleted objects, encrypted config"

# Local dump: encrypted to the age recipient, readable with the private key from the kit.
bash ./backup.sh > /dev/null 2>&1 || die "local dump failed"
dump=$(ls backups/rapiz-*.dump.age 2>/dev/null | tail -1)
[[ -n $dump ]] || die "local dump not encrypted"
[[ $(stat -c %a "$dump") == 600 ]] || die "local dump readable by others"
docker run --rm -i -e K="$age_key" --entrypoint sh rapiz-postgres:local \
  -c 'printf "%s\n" "$K" > /tmp/k; age -d -i /tmp/k | pg_restore --list' < "$dump" | grep -q 'TABLE public t ' ||
  die "encrypted local dump does not decrypt to a restorable dump"
ok "local dump: encrypted, private, restorable with the kit key"

# Object lock: the server deletes nothing off-site; the bucket lifecycle does.
# The test bucket cannot refuse deletes per key (SeaweedFS's Write action covers them), so the media
# step is checked by its effect: a source delete leaves the off-site copy and deleted/ untouched.
echo BACKUP_OBJECT_LOCK=1 >> .env
retain_before=$(grep '^retain_ok=' backups/backup-status)
deleted_before=$(bk rclone lsf -R media:deleted | sort)
bk rclone deletefile src:rapiz/p/b.jpg
printf 'three' | bk rclone rcat src:rapiz/c.jpg
out=$(bash ./backup-nightly.sh 2>&1) || { echo "$out"; die "nightly under object lock failed"; }
grep -q 'retain, prune: skipped' <<<"$out" || die "retain/prune not skipped under object lock: $out"
[[ $(grep '^retain_ok=' backups/backup-status) == "$retain_before" ]] || die "retain ran under object lock"
[[ $(bk prune) == *"skipped"* ]] || die "rapiz-backup prune ran under object lock"
[[ $(bk rclone cat media:current/c.jpg) == three ]] || die "media not copied under object lock"
[[ $(bk rclone cat media:current/p/b.jpg) == two ]] || die "media step deleted off-site under object lock"
[[ $(bk rclone lsf -R media:deleted | sort) == "$deleted_before" ]] || die "media step moved objects under object lock"
sed -i '/^BACKUP_OBJECT_LOCK=/d' .env
ok "object lock: retain and prune skipped, media copied without deletes"

# Drill and point-in-time restore ----------------------------------------------------------------
psqlq "insert into t(note) values ('mid')" >/dev/null
target=$(psqlq "select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")
sleep 2
psqlq "insert into t(note) values ('after')" >/dev/null
psqlq "select pg_switch_wal()" >/dev/null
waitfor '[[ $(ready_wal) == 0 ]]'
# A base backup after the target: the point-in-time restore must start from the one before.
bash ./backup-nightly.sh >> backups/offsite.log 2>&1 || { cat backups/offsite.log; die "third nightly failed"; }
DRILL_TABLES=t DRILL_FRESHNESS=t.at bash ./restore-drill.sh >> backups/drills.log 2>&1 || { cat backups/drills.log; die "drill failed"; }
grep -q 'drill ok' backups/drills.log || die "drill not logged"
[[ -z $(docker volume ls -q -f name=rapiz-bktest_pgdrill) ]] || die "drill volume left behind"
bk rclone lsf offsite:offsite-test/drills | grep -q json || die "drill report not off-site"
DRILL_TARGET_TIME=$target compose up -d pgdrill >/dev/null 2>&1
waitfor '[[ $(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc "select not pg_is_in_recovery()" 2>/dev/null) == t ]]' 90
rows=$(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc "select string_agg(note, ',' order by id) from t")
[[ $rows == before,mid ]] || die "point-in-time restore returned '$rows'"
compose up -d --remove-orphans postgres >/dev/null 2>&1
[[ -n $(compose ps -q --status running pgdrill) ]] || die "deploy's --remove-orphans removed pgdrill"
compose stop pgdrill >/dev/null 2>&1
DRILL_TARGET_TIME='2000-01-01 00:00:00+00' compose up -d pgdrill >/dev/null 2>&1
waitfor '[[ -z $(compose ps -q --status running pgdrill) ]]' 15
compose logs pgdrill 2>&1 | grep -q 'restored for' || die "reused volume with another target not refused"
compose rm -sf pgdrill >/dev/null 2>&1
docker volume rm -f rapiz-bktest_pgdrill >/dev/null
ok "drill passes; point-in-time restore picks the right base backup, stops at the target, refuses a reused volume"

# Check ------------------------------------------------------------------------------------------
out=$(BACKUP_CHECK_DRY_RUN=1 bash ./backup-check.sh)
grep -Eq 'ALERT (wal_|base_|drill_|[a-z]+_failed|db_)' <<<"$out" && die "unexpected alert: $out"
compose stop offsite >/dev/null 2>&1
psqlq "insert into t(note) values ('x')" >/dev/null
psqlq "select pg_switch_wal()" >/dev/null
sleep 5
out=$(BACKUP_CHECK_DRY_RUN=1 BACKUP_WAL_MAX_AGE=1 bash ./backup-check.sh)
grep -q 'ALERT wal_stuck' <<<"$out" || die "stuck archiving not detected: $out"
out=$(BACKUP_CHECK_DRY_RUN=1 BACKUP_WAL_MAX_AGE=1 bash ./backup-check.sh)
grep -q 'ALERT wal_stuck' <<<"$out" && die "alert repeated within the hour"
compose start offsite >/dev/null 2>&1
waitfor '[[ $(ready_wal) == 0 ]]' 90
ok "check: quiet when healthy, alerts once when archiving is stuck, recovers"

# Not configured ---------------------------------------------------------------------------------
sed -i 's/^BACKUP_S3_BUCKET=.*/BACKUP_S3_BUCKET=/' .env
[[ $(bash ./backup-nightly.sh) == *"not configured"* ]] || die "nightly should skip when unconfigured"
rm -rf backups/.alerts
out=$(BACKUP_CHECK_DRY_RUN=1 bash ./backup-check.sh)
grep -q 'ALERT not_configured' <<<"$out" || die "not_configured not reported"
compose up -d --wait postgres >/dev/null 2>&1
psqlq "insert into t(note) values ('y')" >/dev/null
psqlq "select pg_switch_wal()" >/dev/null
waitfor '[[ $(ready_wal) == 0 ]]'
ok "unconfigured: scripts skip, WAL is recycled, check reports it"

ok "all"
