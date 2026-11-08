# Backup & DR (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Off-site, encrypted, restore-tested backups of the production database (PITR, RPO ≤ 1 min), media bucket and server config, with alerts.

**Architecture:** A project postgres image (`rapiz-postgres:local`, built on the server from `infra/deploy/postgres/`) adds WAL-G, rclone and age to `pgvector/pgvector:pg16`. Postgres always runs with `archive_mode=on`; its archive command pushes WAL with WAL-G when `BACKUP_S3_BUCKET` is set and is a no-op otherwise. Host scripts in `/opt/apps/rapiz` (cron) drive nightly base backups, media/config copies (in a `backup` tools container), a weekly restore drill (in a `pgdrill` container) and a 5-minute health check that emails through Resend.

**Tech Stack:** Bash, Docker Compose v2, WAL-G (pinned), rclone (pinned, `s3` + `crypt` remotes from env), age, SeaweedFS (test off-site), Resend HTTP API.

**Spec:** `docs/superpowers/specs/2026-11-08-backup-and-data-export-design.md` (Phase 1), `docs/adr/ADR-028-backup-and-disaster-recovery-single-vps.md`.

## Global Constraints

- Retention: 30 WAL-G full backups (PITR 30 days); media `deleted/<date>` 30 days; 30 config archives; local `pg_dump` 7 days.
- Schedules (server clock is UTC): local dump 03:15 daily; nightly off-site 19:00 daily; check every 5 min; drill Sunday 21:00.
- Alert thresholds: oldest `.ready` WAL > 900 s; base backup older than 26 h; drill older than 8 days; disk > 85 %; `pg_wal` > 5 GiB. Thresholds overridable by env for tests only (`BACKUP_WAL_MAX_AGE`).
- Unconfigured (`BACKUP_S3_BUCKET` empty) must keep every existing deploy working; scripts exit 0 with a log line.
- Encryption before upload, always. The age private key never touches the server.
- No secrets in logs. English everywhere in repo files.
- Scripts: `#!/usr/bin/env bash`, `set -euo pipefail` (nightly uses `set -uo pipefail` so every step runs), pass `shellcheck`.
- Do not edit `.github/` without the owner's explicit OK (Task 6 asks).

---

### Task 1: Postgres image with WAL-G, rclone, age + compose wiring

**Files:**
- Create: `infra/deploy/postgres/Dockerfile`, `infra/deploy/postgres/wal-g-archive`, `infra/deploy/postgres/pg-drill-entrypoint`, `infra/deploy/postgres/rapiz-backup`
- Modify: `infra/deploy/compose.yml` (postgres service, new `backup` and `pgdrill` services, `pgdrill` volume)
- Test: `infra/deploy/test/backup-e2e.sh`, `infra/deploy/test/compose.override.yml`

**Interfaces — Produces:**
- Image `rapiz-postgres:local` with `/usr/local/bin/{wal-g,rclone,age,age-keygen,wal-g-archive,pg-drill-entrypoint,rapiz-backup}`.
- `rapiz-backup media|config|prune|verify <n>|rclone <args…>` with remotes `offsite:` (destination S3), `src:` (SeaweedFS), `media:` (crypt over `offsite:<bucket>/media`).
- Compose services `backup` (profile `tools`, entrypoint `rapiz-backup`) and `pgdrill` (profile `tools`, env `DRILL_TARGET_TIME`, volume `pgdrill`).

- [ ] **Step 1: Pin versions.** Pick the latest WAL-G v3 release asset `wal-g-pg-ubuntu-20.04-amd64.tar.gz` (glibc ≤ Debian bookworm's) and the latest rclone v1 release. Compute checksums:

```bash
curl -fsSL -o /tmp/walg.tgz https://github.com/wal-g/wal-g/releases/download/<ver>/wal-g-pg-ubuntu-20.04-amd64.tar.gz && sha256sum /tmp/walg.tgz
curl -fsSL -o /tmp/rclone.zip https://downloads.rclone.org/<ver>/rclone-<ver>-linux-amd64.zip && sha256sum /tmp/rclone.zip
```

- [ ] **Step 2: Write `postgres/Dockerfile`** with those values in the ARGs:

```dockerfile
# Postgres with the backup tools (ADR-028): WAL-G for WAL archiving and base backups, rclone and
# age for the media and config copies. Built on the server by deploy.sh (`docker compose build`).
FROM pgvector/pgvector:pg16
ARG WALG_VERSION=<ver>
ARG WALG_SHA256=<sha>
ARG RCLONE_VERSION=<ver>
ARG RCLONE_SHA256=<sha>
RUN set -eux; \
  apt-get update; apt-get install -y --no-install-recommends ca-certificates curl unzip age; \
  curl -fsSL -o /tmp/walg.tgz "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-20.04-amd64.tar.gz"; \
  echo "${WALG_SHA256}  /tmp/walg.tgz" | sha256sum -c -; \
  tar -xzf /tmp/walg.tgz -C /tmp; install -m 755 /tmp/wal-g-pg-ubuntu-20.04-amd64 /usr/local/bin/wal-g; \
  curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip"; \
  echo "${RCLONE_SHA256}  /tmp/rclone.zip" | sha256sum -c -; \
  unzip -q /tmp/rclone.zip -d /tmp; install -m 755 "/tmp/rclone-${RCLONE_VERSION}-linux-amd64/rclone" /usr/local/bin/rclone; \
  apt-get purge -y unzip; apt-get autoremove -y; rm -rf /tmp/* /var/lib/apt/lists/*; \
  wal-g --version; rclone version | head -1; age --version
COPY --chmod=755 wal-g-archive pg-drill-entrypoint rapiz-backup /usr/local/bin/
```

- [ ] **Step 3: Write `postgres/wal-g-archive`:**

```sh
#!/bin/sh
# Postgres archive_command (ADR-028). Off-site backups not configured: report success so WAL is
# recycled (backup-check.sh alerts that backups are off). Configured: push; a failure makes
# Postgres keep the segment and retry, and backup-check.sh alerts.
set -eu
[ -n "${BACKUP_S3_BUCKET:-}" ] || exit 0
[ -n "${WALG_LIBSODIUM_KEY:-}" ] || { echo "wal-g-archive: BACKUP_WALG_KEY is missing" >&2; exit 1; }
exec wal-g wal-push "$1"
```

- [ ] **Step 4: Write `postgres/pg-drill-entrypoint`:**

```bash
#!/usr/bin/env bash
# Restore container (ADR-028): on an empty volume, fetch a WAL-G base backup, then replay archived
# WAL to its end (or to DRILL_TARGET_TIME) and promote. Never archives. Used by restore-drill.sh
# and for point-in-time restores (docs/runbooks/backup-and-restore.md).
set -euo pipefail
PGDATA=${PGDATA:-/var/lib/postgresql/data}
if [[ ! -s $PGDATA/PG_VERSION ]]; then
  wal-g backup-fetch "$PGDATA" "${DRILL_BACKUP:-LATEST}"
  touch "$PGDATA/recovery.signal"
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
fi
target=()
if [[ -n ${DRILL_TARGET_TIME:-} ]]; then
  target=(-c "recovery_target_time=$DRILL_TARGET_TIME" -c recovery_target_action=promote)
fi
exec gosu postgres postgres -c archive_mode=off -c 'restore_command=wal-g wal-fetch %f %p' "${target[@]}"
```

- [ ] **Step 5: Write `postgres/rapiz-backup`:**

```bash
#!/usr/bin/env bash
# Off-site copies of media and config (ADR-028), run in the `backup` tools container:
#   rapiz-backup media          sync bucket S3_BUCKET to media:current (encrypted); replaced or
#                               deleted objects move to media:deleted/<UTC date>
#   rapiz-backup config         tar .env + compose.yml, encrypt to BACKUP_AGE_RECIPIENT, upload
#   rapiz-backup prune          drop media:deleted days and config archives beyond 30
#   rapiz-backup verify <n>     compare n random objects with their off-site copies; newest config exists
#   rapiz-backup rclone <args>  rclone with the remotes below (restores, see the runbook)
# Remotes: src: (SeaweedFS), offsite: (BACKUP_S3_*), media: (crypt over offsite:<bucket>/media).
set -euo pipefail
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is not set}" "${BACKUP_RCLONE_PASSWORD:?}" "${BACKUP_RCLONE_SALT:?}"
keep=30
bucket=$BACKUP_S3_BUCKET
export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER=Other \
  RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_S3_ENDPOINT" RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-auto}" \
  RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
  RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=SeaweedFS RCLONE_CONFIG_SRC_ENDPOINT="$S3_ENDPOINT" \
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_ACCESS_KEY" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
RCLONE_CONFIG_MEDIA_PASSWORD=$(rclone obscure "$BACKUP_RCLONE_PASSWORD")
RCLONE_CONFIG_MEDIA_PASSWORD2=$(rclone obscure "$BACKUP_RCLONE_SALT")
export RCLONE_CONFIG_MEDIA_TYPE=crypt RCLONE_CONFIG_MEDIA_REMOTE="offsite:$bucket/media" \
  RCLONE_CONFIG_MEDIA_PASSWORD RCLONE_CONFIG_MEDIA_PASSWORD2
quiet=(--stats 0 --log-level NOTICE)

case ${1:-} in
  media)
    rclone sync "src:$S3_BUCKET" media:current --backup-dir "media:deleted/$(date -u +%F)" --fast-list --transfers 8 "${quiet[@]}"
    ;;
  config)
    : "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"
    tar -C /cfg -czf - .env compose.yml | age -r "$BACKUP_AGE_RECIPIENT" |
      rclone rcat "offsite:$bucket/config/$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age" "${quiet[@]}"
    ;;
  prune)
    cutoff=$(date -u -d "$keep days ago" +%F)
    rclone lsf media:deleted --dirs-only "${quiet[@]}" 2>/dev/null | sed 's:/$::' | while read -r day; do
      if [[ $day < $cutoff ]]; then rclone purge "media:deleted/$day" "${quiet[@]}"; fi
    done
    rclone lsf "offsite:$bucket/config" --files-only "${quiet[@]}" | sort | head -n "-$keep" | while read -r f; do
      rclone deletefile "offsite:$bucket/config/$f" "${quiet[@]}"
    done
    ;;
  verify)
    n=${2:-20}
    rclone lsf -R --files-only "src:$S3_BUCKET" "${quiet[@]}" | shuf -n "$n" | while read -r key; do
      a=$(rclone cat "src:$S3_BUCKET/$key" | sha256sum)
      b=$(rclone cat "media:current/$key" | sha256sum)
      [[ $a == "$b" ]] || { echo "verify: $key differs off-site" >&2; exit 1; }
    done
    newest=$(rclone lsf "offsite:$bucket/config" --files-only "${quiet[@]}" | sort | tail -1)
    [[ -n $newest ]] || { echo "verify: no config archive off-site" >&2; exit 1; }
    echo "verify: ok (newest config $newest)"
    ;;
  rclone) shift; exec rclone "$@" ;;
  *) echo "usage: rapiz-backup media|config|prune|verify <n>|rclone <args>" >&2; exit 2 ;;
esac
```

- [ ] **Step 6: Wire compose.** In `infra/deploy/compose.yml` add, after the `x-app` anchor:

```yaml
# WAL-G settings shared by postgres and the restore container (ADR-028). Empty BACKUP_S3_BUCKET
# = off-site backups off; wal-g-archive then discards WAL as before.
x-walg-env: &walg-env
  BACKUP_S3_BUCKET: ${BACKUP_S3_BUCKET:-}
  WALG_S3_PREFIX: s3://${BACKUP_S3_BUCKET:-none}/wal-g
  AWS_ENDPOINT: ${BACKUP_S3_ENDPOINT:-}
  AWS_REGION: ${BACKUP_S3_REGION:-auto}
  AWS_S3_FORCE_PATH_STYLE: 'true'
  AWS_ACCESS_KEY_ID: ${BACKUP_S3_ACCESS_KEY:-}
  AWS_SECRET_ACCESS_KEY: ${BACKUP_S3_SECRET_KEY:-}
  WALG_LIBSODIUM_KEY: ${BACKUP_WALG_KEY:-}
  WALG_LIBSODIUM_KEY_TRANSFORM: base64
  WALG_COMPRESSION_METHOD: zstd
  PGHOST: /var/run/postgresql
  PGUSER: rapiz_owner
  PGDATABASE: rapiz
```

Replace the postgres service head with:

```yaml
  postgres:
    # pgvector + WAL-G/rclone/age (infra/deploy/postgres, ADR-028), built on the server by deploy.sh.
    image: rapiz-postgres:local
    build: ./postgres
    restart: unless-stopped
    command: ['postgres', '-c', 'archive_mode=on', '-c', 'archive_command=/usr/local/bin/wal-g-archive %p', '-c', 'archive_timeout=60']
    environment:
      <<: *walg-env
      POSTGRES_USER: rapiz_owner
      POSTGRES_PASSWORD: ${POSTGRES_OWNER_PASSWORD:?set in .env}
      POSTGRES_DB: rapiz
```

and change its `networks: [backend]` to `networks: [default, backend]` with the comment `# default: egress to the off-site bucket for WAL archiving (no published port).` Add before `edge:`:

```yaml
  # Off-site media/config copies (infra/deploy/postgres/rapiz-backup); run by backup-nightly.sh.
  backup:
    image: rapiz-postgres:local
    pull_policy: never
    profiles: [tools]
    env_file: .env
    entrypoint: ['rapiz-backup']
    volumes: ['./.env:/cfg/.env:ro', './compose.yml:/cfg/compose.yml:ro']
    networks: [default, backend]
    logging: *logging

  # Throwaway restore target of restore-drill.sh and point-in-time restores (runbook).
  pgdrill:
    image: rapiz-postgres:local
    pull_policy: never
    profiles: [tools]
    entrypoint: ['pg-drill-entrypoint']
    environment:
      <<: *walg-env
      DRILL_TARGET_TIME: ${DRILL_TARGET_TIME:-}
    volumes: [pgdrill:/var/lib/postgresql/data]
    shm_size: 256m
    networks: [default]
    logging: *logging
```

and `pgdrill:` under `volumes:`.

- [ ] **Step 7: Write the e2e harness** `infra/deploy/test/compose.override.yml` (auto-merged by compose in the work dir):

```yaml
# Test only (backup-e2e.sh): a second SeaweedFS as the off-site destination.
services:
  offsite:
    image: chrislusf/seaweedfs:latest
    entrypoint: ['/bin/sh', '-c']
    command:
      - |
        cat > /tmp/s3.json <<JSON
        {"identities":[{"name":"o","credentials":[{"accessKey":"offsite","secretKey":"offsitesecret"}],
          "actions":["Admin","Read","Write","List","Tagging"]}]}
        JSON
        exec weed server -dir=/data -s3 -s3.config=/tmp/s3.json -master.volumeSizeLimitMB=64 -volume.max=0
    networks: [default]
```

and `infra/deploy/test/backup-e2e.sh` (first section; later tasks append sections before `ok "all"`):

```bash
#!/usr/bin/env bash
# End-to-end test of off-site backups (ADR-028). Needs Docker and network (builds the postgres
# image). Runs the real compose file in project rapiz-bktest with a second SeaweedFS as the
# off-site bucket, then removes everything. Usage: bash infra/deploy/test/backup-e2e.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=$(dirname "$here")
work=$(mktemp -d)
export COMPOSE_PROJECT_NAME=rapiz-bktest
cd "$work"
cp "$src"/{compose.yml,backup.sh,backup-lib.sh,backup-nightly.sh,backup-check.sh,restore-drill.sh,backup-keys.sh} . 2>/dev/null || true
cp -r "$src/postgres" . && cp "$here/compose.override.yml" .
compose() { docker compose --env-file .env "$@"; }
ok() { echo "ok - $*"; }
die() { echo "FAIL - $*" >&2; exit 1; }
teardown() { compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$work"; }
trap teardown EXIT
psqlq() { compose exec -T postgres psql -U rapiz_owner -d rapiz -Atc "$1"; }
mkbucket() { compose exec -T "$1" sh -c "echo 's3.bucket.create -name $2' | weed shell" >/dev/null; }
waitfor() { local i; for i in $(seq 1 "${2:-60}"); do eval "$1" && return 0; sleep 2; done; die "timeout: $1"; }

cat > .env <<'ENV'
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
compose build -q postgres
compose up -d --wait postgres object-storage offsite
waitfor "compose exec -T offsite sh -c \"echo s3.bucket.list | weed shell\" >/dev/null 2>&1"
mkbucket offsite offsite-test; mkbucket object-storage rapiz
psqlq "create table t(id serial, at timestamptz default clock_timestamp(), note text); insert into t(note) values ('before'); select pg_switch_wal();" >/dev/null
waitfor '[[ $(psqlq "select count(*) from pg_ls_archive_statusdir() where name like '"'"'%.ready'"'"'") == 0 ]]'
compose exec -T -u postgres postgres wal-g wal-show >/dev/null || die "no WAL off-site"
ok "WAL is archived off-site"

ok "all"
```

- [ ] **Step 8: Run** `bash infra/deploy/test/backup-e2e.sh`. Expected: `ok - WAL is archived off-site`, `ok - all`. Fix until green.
- [ ] **Step 9: Commit** `feat(infra): postgres image with WAL-G and archive to an off-site bucket`.

### Task 2: Nightly off-site backup (base, media, config, prune)

**Files:** Create `infra/deploy/backup-lib.sh`, `infra/deploy/backup-nightly.sh`; extend `infra/deploy/test/backup-e2e.sh`.

**Interfaces — Produces** (`backup-lib.sh`, sourced from the app folder): `compose`, `env_get KEY`, `configured`, `project`, `log`, `pg_q SQL`, `status_set KEY`, `status_get KEY` (epoch or 0; file `backups/backup-status`, lines `key=epoch`), `send_email TO SUBJECT TEXT`, `install_backup_cron DIR`. Status keys: `base_ok|base_failed`, `retain_*`, `media_*`, `config_*`, `prune_*`, `drill_ok|drill_failed`.

- [ ] **Step 1: Add the failing e2e section** (before `ok "all"`):

```bash
mkdir -p backups
printf 'one' | compose run --rm -T backup rclone rcat src:rapiz/a.jpg
printf 'two' | compose run --rm -T backup rclone rcat src:rapiz/b.jpg
cp "$src/../../infra/deploy/backup-keys.sh" . 2>/dev/null || true
kit=$(bash ./backup-keys.sh) || die "backup-keys failed"
grep -q 'AGE-SECRET-KEY-' <<<"$kit" || die "kit has no age key"
grep -q '^BACKUP_AGE_RECIPIENT=age1' .env || die "no recipient in .env"
bash ./backup-nightly.sh || die "nightly failed"
grep -q '^base_ok=' backups/backup-status || die "base_ok not recorded"
compose exec -T -u postgres postgres wal-g backup-list | grep -q base_ || die "no base backup"
[[ $(compose run --rm -T backup rclone cat media:current/a.jpg) == one ]] || die "media not copied"
compose run --rm -T backup rclone delete src:rapiz/a.jpg
bash ./backup-nightly.sh || die "second nightly failed"
compose run --rm -T backup rclone lsf -R "media:deleted" | grep -q 'a.jpg' || die "deleted object not kept"
age_key=$(grep 'AGE-SECRET-KEY-' <<<"$kit")
newest=$(compose run --rm -T backup rclone lsf offsite:offsite-test/config | sort | tail -1)
compose run --rm -T backup rclone cat "offsite:offsite-test/config/$newest" |
  docker run --rm -i --entrypoint sh rapiz-postgres:local -c "printf '%s\n' '$age_key' > /tmp/k; age -d -i /tmp/k | tar -xzO .env" |
  grep -q '^BACKUP_S3_BUCKET=offsite-test' || die "config archive does not decrypt"
ok "nightly: base backup, media sync with deleted copies, encrypted config"
```

(Task 5 creates `backup-keys.sh`; until then this test fails at `backup-keys` — do Task 5 Step 3 now if executing strictly in order, or temporarily set the age vars by hand. Recommended: implement `backup-keys.sh` here, Task 5 then only wires bootstrap/deploy.)

- [ ] **Step 2: Run** the e2e; expect FAIL (`backup-lib.sh`/`backup-nightly.sh` missing).
- [ ] **Step 3: Write `backup-lib.sh`:**

```bash
# Helpers for the backup scripts (ADR-028); sourced with the app folder as working directory.
# shellcheck shell=bash
compose() { docker compose --env-file .env "$@"; }
env_get() { local v; v=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-) || true; v=${v%\"}; v=${v#\"}; printf '%s' "$v"; }
configured() { [[ -n $(env_get BACKUP_S3_BUCKET) ]]; }
project() { printf '%s' "${COMPOSE_PROJECT_NAME:-rapiz}"; }
log() { echo "$(date -u +%FT%TZ) $*"; }
pg_q() { compose exec -T postgres psql -U rapiz_owner -d rapiz -Atc "$1"; }

BACKUP_STATUS=backups/backup-status
status_set() {
  mkdir -p backups; touch "$BACKUP_STATUS"
  { grep -v "^$1=" "$BACKUP_STATUS" || true; echo "$1=$(date +%s)"; } > "$BACKUP_STATUS.tmp"
  mv "$BACKUP_STATUS.tmp" "$BACKUP_STATUS"
}
status_get() { local v; v=$(grep -E "^$1=" "$BACKUP_STATUS" 2>/dev/null | cut -d= -f2) || true; echo "${v:-0}"; }

# send_email <to> <subject> <text>: Resend HTTP API (ADR-023 key). Text must not contain quotes.
send_email() {
  local key; key=$(env_get RESEND_API_KEY)
  [[ -n $key ]] || { log "send_email: RESEND_API_KEY is not set"; return 1; }
  curl -fsS -m 20 https://api.resend.com/emails -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
    -d "$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' "$(env_get EMAIL_FROM)" "$1" "$2" "$3")" >/dev/null
}

# install_backup_cron <app dir>: idempotent crontab lines for every backup script (UTC clock).
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
```

- [ ] **Step 4: Write `backup-nightly.sh`:**

```bash
#!/usr/bin/env bash
# Nightly off-site backup (ADR-028; cron 19:00 UTC = 02:00 Vietnam): WAL-G base backup and
# retention (30 full), encrypted media sync, encrypted config, pruning. Every step runs even if
# an earlier one failed; the result of each is recorded for backup-check.sh. Exit 1 if any failed.
set -uo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
configured || { log "backup: off-site not configured"; exit 0; }
failed=0
step() {
  local name=$1; shift
  if "$@"; then status_set "${name}_ok"; log "$name: ok"; else status_set "${name}_failed"; log "$name: FAILED"; failed=1; fi
}
step base compose exec -T -u postgres postgres wal-g backup-push /var/lib/postgresql/data
step retain compose exec -T -u postgres postgres wal-g delete retain FULL 30 --confirm
step media compose run --rm -T backup media
step config compose run --rm -T backup config
step prune compose run --rm -T backup prune
exit "$failed"
```

- [ ] **Step 5: Run e2e** → expect `ok - nightly: …`. **Step 6: Commit** `feat(infra): nightly off-site base backup, media and config copies`.

### Task 3: Weekly restore drill and point-in-time restore

**Files:** Create `infra/deploy/restore-drill.sh`; extend the e2e.

**Interfaces — Consumes:** `backup-lib.sh`, `pgdrill` and `backup verify`. **Produces:** status keys `drill_ok|drill_failed`, `backups/drills.log` lines `"<ts> drill ok <seconds>s tables=<…>"`, off-site `drills/<UTC date>.json`. Env: `DRILL_TABLES` (default `workspaces conversations conversation_messages orders contacts`), `DRILL_FRESHNESS` (default `conversation_messages.created_at`), `DRILL_TIMEOUT` (default 3600 s).

- [ ] **Step 1: Failing e2e section:**

```bash
psqlq "insert into t(note) values ('mid')" >/dev/null
target=$(psqlq "select to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD HH24:MI:SS.US+00')")
sleep 2
psqlq "insert into t(note) values ('after'); select pg_switch_wal();" >/dev/null
waitfor '[[ $(psqlq "select count(*) from pg_ls_archive_statusdir() where name like '"'"'%.ready'"'"'") == 0 ]]'
DRILL_TABLES=t DRILL_FRESHNESS=t.at bash ./restore-drill.sh || die "drill failed"
grep -q 'drill ok' backups/drills.log || die "drill not logged"
[[ -z $(docker volume ls -q -f name=rapiz-bktest_pgdrill) ]] || die "drill volume left behind"
DRILL_TARGET_TIME=$target compose up -d pgdrill
waitfor '[[ $(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc "select not pg_is_in_recovery()" 2>/dev/null) == t ]]' 90
[[ $(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc "select string_agg(note, ',' order by id) from t") == before,mid ]] || die "PITR returned the wrong rows"
compose rm -sf pgdrill >/dev/null; docker volume rm -f rapiz-bktest_pgdrill >/dev/null
ok "drill passes; point-in-time restore stops at the target"
```

- [ ] **Step 2: Run** → FAIL (no `restore-drill.sh`).
- [ ] **Step 3: Write `restore-drill.sh`:**

```bash
#!/usr/bin/env bash
# Weekly restore drill (ADR-028; cron Sunday 21:00 UTC). Restores the newest off-site base backup
# plus archived WAL into the throwaway `pgdrill` container, compares row counts and the newest
# row time with production, checks 20 media objects and the newest config archive, records the
# result (backups/drills.log, status drill_ok/drill_failed, off-site drills/<date>.json) and
# removes the container and its volume.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
configured || { log "drill: off-site not configured"; exit 0; }
tables=${DRILL_TABLES:-workspaces conversations conversation_messages orders contacts}
fresh=${DRILL_FRESHNESS:-conversation_messages.created_at}
vol="$(project)_pgdrill"
started=$(date +%s)
cleanup() { compose rm -sf pgdrill >/dev/null 2>&1 || true; docker volume rm -f "$vol" >/dev/null 2>&1 || true; }
fail() { log "drill FAILED: $*"; status_set drill_failed; exit 1; }
trap cleanup EXIT

db_bytes=$(pg_q "select pg_database_size('rapiz')")
root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)
free=$(df -P -B1 "$root" 2>/dev/null | awk 'NR==2{print $4}' || df -P -B1 / | awk 'NR==2{print $4}')
(( free > 2 * db_bytes )) || fail "not enough free disk ($free bytes) for a restore of $db_bytes bytes"

query="select concat_ws(' '"
for t in $tables; do query+=", (select count(*) from $t)"; done
query+=", coalesce((select extract(epoch from max(${fresh#*.}))::bigint from ${fresh%%.*}), 0))"

cleanup
compose up -d pgdrill >/dev/null
deadline=$(( $(date +%s) + ${DRILL_TIMEOUT:-3600} ))
until [[ $(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc 'select not pg_is_in_recovery()' 2>/dev/null) == t ]]; do
  (( $(date +%s) < deadline )) || fail "restore did not finish in ${DRILL_TIMEOUT:-3600}s"
  [[ $(docker inspect -f '{{.State.Running}}' "$(compose ps -aq pgdrill)" 2>/dev/null) == true ]] ||
    fail "restore container stopped: $(compose logs --tail 5 pgdrill 2>&1 | tr '\n' ' ')"
  sleep 5
done
read -r -a prod <<<"$(pg_q "$query")"
read -r -a drill <<<"$(compose exec -T pgdrill psql -U rapiz_owner -d rapiz -Atc "$query")"
i=0
for t in $tables; do
  p=${prod[i]} d=${drill[i]}
  (( d * 100 >= p * 99 )) || fail "$t: restored $d rows, production has $p"
  i=$((i + 1))
done
(( prod[i] - drill[i] <= 900 )) || fail "newest $fresh is $(( prod[i] - drill[i] ))s behind production"
compose run --rm -T backup verify 20 >/dev/null || fail "media or config check failed"

secs=$(( $(date +%s) - started ))
status_set drill_ok
log "drill ok ${secs}s tables=$(tr ' ' ',' <<<"$tables") rows=$(tr ' ' ',' <<<"${drill[*]}")"
printf '{"ok":true,"seconds":%d,"at":"%s"}\n' "$secs" "$(date -u +%FT%TZ)" |
  compose run --rm -T backup rclone rcat "offsite:$(env_get BACKUP_S3_BUCKET)/drills/$(date -u +%F).json" || true
```

Note `restore-drill.sh` logs to stdout; cron appends stdout to `backups/drills.log`. In the e2e, call it as `bash ./restore-drill.sh >> backups/drills.log` so the `grep` works — adjust the Step 1 line to `DRILL_TABLES=t DRILL_FRESHNESS=t.at bash ./restore-drill.sh >> backups/drills.log || die "drill failed"`.

- [ ] **Step 4: Run e2e** → `ok - drill passes…`. **Step 5: Commit** `feat(infra): weekly restore drill and point-in-time restore container`.

### Task 4: Health check with email alerts

**Files:** Create `infra/deploy/backup-check.sh`; extend e2e.

**Interfaces — Consumes:** `backup-lib.sh` status keys. **Produces:** alert keys `not_configured, db_unreachable, wal_stuck, wal_failing, base_stale, <step>_failed, drill_stale, drill_failed, disk_full, wal_dir_large`; `BACKUP_CHECK_DRY_RUN=1` prints `ALERT <key>: <text>` without email; `BACKUP_WAL_MAX_AGE` (default 900).

- [ ] **Step 1: Failing e2e section:**

```bash
out=$(BACKUP_CHECK_DRY_RUN=1 bash ./backup-check.sh)
grep -Eq 'ALERT (wal_|base_|drill_|.*_failed)' <<<"$out" && die "unexpected alert: $out"
compose stop offsite >/dev/null
psqlq "insert into t(note) values ('x'); select pg_switch_wal();" >/dev/null
sleep 5
out=$(BACKUP_CHECK_DRY_RUN=1 BACKUP_WAL_MAX_AGE=1 bash ./backup-check.sh)
grep -q 'ALERT wal_stuck' <<<"$out" || die "stuck archiving not detected: $out"
out=$(BACKUP_CHECK_DRY_RUN=1 BACKUP_WAL_MAX_AGE=1 bash ./backup-check.sh)
grep -q 'ALERT wal_stuck' <<<"$out" && die "alert repeated within the hour"
compose start offsite >/dev/null
ok "check: quiet when healthy, alerts once on stuck archiving"
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Write `backup-check.sh`:**

```bash
#!/usr/bin/env bash
# Backup health check (ADR-028; cron every 5 minutes). Emails BACKUP_ALERT_EMAIL (Resend) when
# off-site backups are off, WAL archiving is stuck or failing, a nightly step or the weekly drill
# failed or is overdue, or the disk is filling. One email per alert per hour (per day for
# not_configured). BACKUP_CHECK_DRY_RUN=1 prints the alerts instead of sending them.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
now=$(date +%s)
alerts=()
add() { alerts+=("$1|$2"); }

if ! configured; then
  add not_configured "Off-site backups are not configured (BACKUP_S3_BUCKET is empty in .env)."
elif ! wal=$(pg_q "select count(*), coalesce(extract(epoch from now() - min(modification))::bigint, 0) from pg_ls_archive_statusdir() where name like '%.ready'") ||
  ! failing=$(pg_q "select coalesce(last_failed_time > coalesce(last_archived_time, '-infinity'), false) from pg_stat_archiver"); then
  add db_unreachable "The backup check cannot query Postgres."
else
  IFS='|' read -r ready oldest <<<"$wal"
  if (( oldest > ${BACKUP_WAL_MAX_AGE:-900} )); then add wal_stuck "$ready WAL segments wait for upload, oldest ${oldest}s. Check the off-site bucket; pg_wal grows until it works."; fi
  if [[ $failing == t ]]; then add wal_failing "The last WAL upload failed (see docker compose logs postgres)."; fi
  if (( now - $(status_get base_ok) > 26 * 3600 )); then add base_stale "No successful base backup for more than 26 hours."; fi
  for s in base retain media config prune; do
    if (( $(status_get "${s}_failed") > $(status_get "${s}_ok") )); then add "${s}_failed" "Nightly step $s failed (backups/offsite.log)."; fi
  done
  if (( now - $(status_get drill_ok) > 8 * 86400 )); then add drill_stale "No successful restore drill for more than 8 days."; fi
  if (( $(status_get drill_failed) > $(status_get drill_ok) )); then add drill_failed "The last restore drill failed (backups/drills.log)."; fi
fi
root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)
pct=$(df -P "$root" 2>/dev/null | awk 'NR==2{sub("%","",$5); print $5}' || echo 0)
if (( ${pct:-0} > 85 )); then add disk_full "Disk at ${pct}% on $root."; fi
walbytes=$(pg_q "select coalesce(sum(size), 0) from pg_ls_waldir()" 2>/dev/null || echo 0)
if (( walbytes > 5 * 1024 ** 3 )); then add wal_dir_large "pg_wal holds $(( walbytes / 1024 ** 2 )) MiB."; fi

to=$(env_get BACKUP_ALERT_EMAIL)
host=$(env_get PUBLIC_HOST)
mkdir -p backups/.alerts
for a in "${alerts[@]}"; do
  key=${a%%|*} text=${a#*|}
  window=3600; [[ $key == not_configured ]] && window=86400
  mark=backups/.alerts/$key
  if [[ -f $mark ]] && (( now - $(stat -c %Y "$mark") < window )); then continue; fi
  log "ALERT $key: $text"
  if [[ ${BACKUP_CHECK_DRY_RUN:-} == 1 ]]; then touch "$mark"; continue; fi
  [[ -n $to ]] || continue
  if send_email "$to" "[Rapiz ${host:-server}] backup alert: $key" "$text See docs/runbooks/backup-and-restore.md."; then touch "$mark"; fi
done
```

- [ ] **Step 4: Run e2e** → `ok - check: …`. **Step 5: Commit** `feat(infra): backup health check with email alerts`.

### Task 5: Keys, bootstrap, deploy, local dump retention

**Files:** Create `infra/deploy/backup-keys.sh`; modify `infra/deploy/bootstrap.sh`, `infra/deploy/deploy.sh`, `infra/deploy/backup.sh`.

- [ ] **Step 1: `backup-keys.sh`:**

```bash
#!/usr/bin/env bash
# Generates the off-site backup keys once (ADR-028), adds every missing BACKUP_* line to .env and
# prints the break-glass kit a single time. Store the kit outside the server (password manager):
# without it the off-site backups cannot be read. Never changes an existing key.
set -euo pipefail
cd "$(dirname "$0")"
. ./backup-lib.sh
if [[ -n $(env_get BACKUP_WALG_KEY) ]]; then echo "backup keys already in .env; nothing to do"; exit 0; fi
docker image inspect rapiz-postgres:local >/dev/null 2>&1 || compose build -q postgres
walg=$(openssl rand -base64 32) pass=$(openssl rand -hex 24) salt=$(openssl rand -hex 24)
agekey=$(docker run --rm --entrypoint age-keygen rapiz-postgres:local 2>/dev/null)
recipient=$(sed -n 's/^# public key: //p' <<<"$agekey")
umask 077
add() { grep -qE "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env; }
printf '\n# Off-site backups (ADR-028, docs/runbooks/backup-and-restore.md). The age private key is not here.\n' >> .env
add BACKUP_S3_ENDPOINT ''; add BACKUP_S3_REGION auto; add BACKUP_S3_BUCKET ''
add BACKUP_S3_ACCESS_KEY ''; add BACKUP_S3_SECRET_KEY ''; add BACKUP_ALERT_EMAIL ''
sed -i '/^BACKUP_WALG_KEY=$/d;/^BACKUP_RCLONE_PASSWORD=$/d;/^BACKUP_RCLONE_SALT=$/d;/^BACKUP_AGE_RECIPIENT=$/d' .env
add BACKUP_WALG_KEY "$walg"; add BACKUP_RCLONE_PASSWORD "$pass"; add BACKUP_RCLONE_SALT "$salt"; add BACKUP_AGE_RECIPIENT "$recipient"
cat <<KIT
===== RAPIZ BREAK-GLASS KIT: store it in a password manager now; it is not shown again =====
BACKUP_WALG_KEY=$walg
BACKUP_RCLONE_PASSWORD=$pass
BACKUP_RCLONE_SALT=$salt
$agekey
Also store the BACKUP_S3_* values from .env.
=============================================================================================
KIT
```

(The e2e `.env` already has WALG/RCLONE keys: change its fixture to leave `BACKUP_WALG_KEY`, `BACKUP_RCLONE_PASSWORD`, `BACKUP_RCLONE_SALT` out, and move `compose up -d --wait postgres …` after `bash ./backup-keys.sh` so postgres starts with the key. Task 1's archive check then runs after the keys exist.)

- [ ] **Step 2: `deploy.sh`:** `compose pull --quiet` → `compose pull --quiet --ignore-buildable`; before `compose up -d --wait postgres redis object-storage` add `compose build -q postgres`; after `echo "$tag" > .deployed-tag` add:

```bash
# Backup cron lines (ADR-028); idempotent, so every deploy keeps them current.
. ./backup-lib.sh
install_backup_cron "$PWD"
```

- [ ] **Step 3: `bootstrap.sh`:** copy loop gets `backup-lib.sh backup-nightly.sh backup-check.sh restore-drill.sh backup-keys.sh` and `cp -r "$HERE/postgres" "$DIR/"`; replace the crontab block with `( cd "$DIR" && . ./backup-lib.sh && install_backup_cron "$DIR" )`; final echo adds `run ./backup-keys.sh, store the kit, fill BACKUP_* (docs/runbooks/backup-and-restore.md)`. Update the header comment.
- [ ] **Step 4: `backup.sh`:** `-mtime +14` → `-mtime +7`, comment "Keeps 7 days; off-site copies: backup-nightly.sh (ADR-028)".
- [ ] **Step 5:** Run e2e (full) and `docker run --rm -v "$PWD/infra/deploy:/mnt" koalaman/shellcheck:stable -x /mnt/*.sh /mnt/postgres/rapiz-backup /mnt/postgres/pg-drill-entrypoint /mnt/postgres/wal-g-archive /mnt/test/backup-e2e.sh` → clean. Also test cron install in a throwaway container: `docker run --rm -v "$PWD/infra/deploy:/d" debian:bookworm-slim bash -c 'apt-get -qq update >/dev/null && apt-get -qq install -y cron >/dev/null && cd /d && . ./backup-lib.sh && install_backup_cron /opt/apps/rapiz && install_backup_cron /opt/apps/rapiz && crontab -l'` → exactly 4 lines.
- [ ] **Step 6: Commit** `feat(infra): backup keys, cron install on deploy, 7-day local dumps`.

### Task 6: Docs, runbook, CI file sync

**Files:** Create `docs/runbooks/backup-and-restore.md`; modify `docs/runbooks/deploy-vps.md` (backup row, Restore section, remove "off-site backup is not automated yet", files list), `docs/10-operations-and-deployment.md` §7, spec (media layout `media/current` + `media/deleted/<date>`, config = `.env` + `compose.yml`, no wrapper/entrypoint — archive_mode always on with the no-op archive command, postgres joins `default` for egress), ADR-028 consequences (postgres gets egress), `.github/workflows/deploy.yml` **only with the owner's OK**.

- [ ] **Step 1:** Runbook sections A–D + alert table exactly as spec §1.6, using `docker compose run --rm backup rclone …` and `DRILL_TARGET_TIME='YYYY-MM-DD HH:MM:SS+07' docker compose up -d pgdrill` for PITR; full-server-loss steps: new VPS → `bootstrap.sh` → paste kit + `BACKUP_S3_*` into `.env` → `docker compose build postgres` → `docker compose up -d pgdrill` (restores into the `pgdrill` volume) → stop it, copy that volume into `pgdata` (`docker run --rm -v rapiz_pgdrill:/from -v rapiz_pgdata:/to alpine cp -a /from/. /to/`) → `docker compose run --rm backup rclone copy media:current src:rapiz` → decrypt newest config with the age key and compare → `./deploy.sh <tag>`.
- [ ] **Step 2:** Ask the owner for OK to change `deploy.yml` "Sync server files" to: `scp -q -r infra/deploy/compose.yml infra/deploy/*.sh infra/deploy/postgres "$TARGET:/opt/apps/rapiz/"`. Without it, auto-deploys do not ship the new files and `docker compose build postgres` fails on the server (state this in the PR).
- [ ] **Step 3:** `pnpm check`, commit `docs: backup and restore runbook (ADR-028)`.

### Task 7: Verify and open the PR

- [ ] Full e2e green, shellcheck clean, `pnpm check` green; open PR via the `open-pr` skill with the e2e output and the owner actions (spec §1.8). Production rollout (build image on server, keys, kit to owner, bucket) happens after merge with the owner.
