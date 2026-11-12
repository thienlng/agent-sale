# Runbook — backup and restore

Decision: [ADR-028](../adr/ADR-028-backup-and-disaster-recovery-single-vps.md). Design: [spec](../superpowers/specs/2026-11-08-backup-and-data-export-design.md) §Phase 1. All commands run as `deploy` in `/opt/apps/rapiz` on the server unless stated otherwise.

## What is protected

| Data | How | RPO | Kept |
|---|---|---|---|
| PostgreSQL | WAL-G: every WAL segment is uploaded (at least once a minute while the database writes) + a base backup each night at 19:00 UTC | ≤ 1 min | 30 base backups → point-in-time recovery over 30 days |
| Pictures and files (bucket `rapiz`) | `rclone sync` to an encrypted rclone `crypt` remote each night; replaced or deleted objects go to `media:deleted/<UTC date>` | ≤ 24 h | live copy + 30 days of deleted/replaced objects |
| `.env`, `compose.yml` | tar → `age` (public key only on the server) each night | ≤ 24 h | 30 archives |
| Local dump `backups/rapiz-*.dump.age` (`rapiz-*.dump` while `BACKUP_AGE_RECIPIENT` is unset) | `backup.sh` daily at 03:15 UTC and by `deploy.sh` before every deploy; encrypted to the kit's age key, mode 600 | 24 h | same disk; 7 days once off-site backups are on, 14 days before |

Not backed up: Redis (queues and caches; rebuilt by outbox and reconcile jobs), the `hermes` volume (test-only ChatGPT login). The edge (Caddy) keeps no state.

Off-site bucket layout: `wal-g/` (WAL-G), `media/` (encrypted names and content: `current/`, `deleted/<date>/`), `config/<timestamp>.tar.gz.age`, `drills/<date>.json` (drill results, no data).

| Cron (UTC) | Script | Log |
|---|---|---|
| 03:15 daily | `backup.sh` | `backups/backup.log` |
| 19:00 daily | `backup-nightly.sh` | `backups/offsite.log` |
| every 5 min | `backup-check.sh` | `backups/check.log` |
| 21:00 Sunday | `restore-drill.sh` | `backups/drills.log` |

`deploy.sh` reinstalls these lines on every deploy. The nightly job, the drill and nothing else share a lock (`backups/.lock`); the drill skips while a `pgdrill` container exists (a manual restore). Running `./backup-nightly.sh` by hand several times a day is fine but each run counts towards the 30 kept base backups, which shortens the point-in-time window.

## Switching it on (once)

1. Create a bucket with any S3-compatible provider (Cloudflare R2, Backblaze B2, MinIO on another host…) and protect it as in [Protect the off-site copy](#protect-the-off-site-copy): versioning, Object Lock and a key that cannot destroy versions.
2. `./backup-keys.sh`: generates the WAL-G key, the rclone crypt password and salt, and an age key pair. It writes the public values to `.env` and prints the **break-glass kit** once. Put the kit in the owner's password manager **now**: without it nobody can read the backups. The age private key is only in the kit.
3. Fill `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` (`auto` for R2), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` and `BACKUP_ALERT_EMAIL` in `.env`. Alerts are sent with the existing `RESEND_API_KEY`.
4. `RAPIZ_SKIP_PULL=1 ./deploy.sh "$(cat .deployed-tag)"` (the images are already on the server; CI logs out of GHCR after each deploy). Postgres restarts with the new settings (about 10 s).
5. `./backup-nightly.sh` and then `./restore-drill.sh`. Both must end without `FAILED`.
6. Put the kit's age key in a file on your own machine and decrypt the newest config archive once (section D), to prove the kit works.

### Protect the off-site copy

The server holds the off-site key, so whoever takes over the server holds it too. The bucket, not the server, must decide what can be destroyed:

1. **Versioning on.** A delete or overwrite then only adds a new version or a delete marker; the old version stays.
2. **Object Lock** with a default retention of at least 30 days (governance or compliance mode), where the provider has it (AWS S3, Backblaze B2, MinIO, Wasabi). Locked versions cannot be removed before the retention ends, whatever key asks.
3. **An append-only key for the server.** Allowed: list, read, write, and plain deletes (`s3:DeleteObject`, which only adds delete markers under versioning). Denied: deleting versions (`s3:DeleteObjectVersion`), bypassing governance retention, and changing the bucket's versioning, lock, lifecycle or policy. Keep a separate admin key off the server (password manager) for restores of old versions and for policy changes.
4. **Lifecycle rules** do the real expiry: delete noncurrent versions 30 days after they became noncurrent, and remove expired delete markers.

With that set-up the nightly `retain` (WAL-G) and `prune` steps stay on: their deletes only add delete markers, and the lifecycle rule frees the space once the lock ends. If the provider cannot issue a key that may add delete markers (deletes are refused outright), set `BACKUP_OBJECT_LOCK=1` in `.env`: the nightly job then skips `retain` and `prune` and the server deletes nothing off-site itself. Expire `wal-g/` and `config/` with lifecycle rules by age instead (35 days keeps 30 days of point-in-time recovery). `media/` names are encrypted, so `media:deleted/` cannot be targeted by prefix; run `rapiz-backup prune` from a trusted machine with the admin key when it grows. `BACKUP_OBJECT_LOCK` is off by default.

Check the result from your own machine with the admin key (bucket versioning status, lock configuration, lifecycle rules) and, with the server key, that deleting a version is refused.

## A. Undo a mistake (rows deleted or changed by error)

Production keeps running. Restore a copy to a moment just before the mistake, then copy the rows back. The restore container picks the newest base backup that finished before the target by itself (or set `DRILL_BACKUP=<name>` from `docker compose exec -u postgres postgres wal-g backup-list`). A `pgdrill` volume restored for one time refuses another: remove it first.

```bash
docker compose rm -sf pgdrill; docker volume rm rapiz_pgdrill 2>/dev/null
# Time with an explicit zone. Vietnam is +07.
DRILL_TARGET_TIME='2026-11-08 10:41:00+07' docker compose up -d pgdrill
docker compose logs pgdrill | head   # shows which base backup it restores
# Ready when this prints t (large databases take minutes):
docker compose exec pgdrill psql -U rapiz_owner -d rapiz -Atc 'select not pg_is_in_recovery()'
# Inspect, then copy the needed rows out of the copy and into production, e.g.:
docker compose exec -T pgdrill psql -U rapiz_owner -d rapiz -c "\copy (select * from orders where id in (...)) to stdout" |
  docker compose exec -T postgres psql -U rapiz_owner -d rapiz -c "\copy orders from stdin"
# Clean up:
docker compose rm -sf pgdrill && docker volume rm rapiz_pgdrill
```

Keep foreign keys in mind: restore parent rows (e.g. `orders`) before child rows (`order_items`).

If the mistake is too large to copy rows, replace the whole database with the restored copy: restore into `pgdrill` as above, wait for `t`, `docker compose stop pgdrill`, then `docker compose stop api agent worker webhook postgres` and run B5. Everything written after the target time is lost; B5 keeps the replaced data in `rapiz_pgdata_pre_restore` until you delete it.

## B. The whole server is lost

You need: the break-glass kit, the `BACKUP_S3_*` values and a new server prepared as in [deploy-vps.md](deploy-vps.md#first-install-once-per-server).

1. Copy `infra/deploy` to the server and run `bash bootstrap.sh <host>` (it writes a fresh `.env`).
2. Overwrite the fresh `.env` with the original: fetch the newest config archive and decrypt it **on your own machine** with the age key from the kit (section D), then upload that `.env` to `/opt/apps/rapiz/.env` (mode 600). It contains the original `SECRETS_ENCRYPTION_KEY`, JWT keys and VAPID pair. If no archive can be read, put the kit and `BACKUP_S3_*` lines into the fresh `.env` instead and expect to reconnect channels.
3. `docker compose build postgres`.
4. Restore the database into the `pgdrill` volume: `docker compose up -d pgdrill`, wait until `docker compose exec pgdrill psql -U rapiz_owner -d rapiz -Atc 'select not pg_is_in_recovery()'` prints `t`, then `docker compose stop pgdrill`.
5. Move it into place. Postgres must be stopped. The current contents are kept in `rapiz_pgdata_pre_restore` (empty on a new server), then `rapiz_pgdata` is emptied before the copy so two clusters never mix:
   ```bash
   docker compose stop postgres 2>/dev/null || true
   docker volume create rapiz_pgdata >/dev/null
   docker volume create rapiz_pgdata_pre_restore >/dev/null
   docker run --rm -v rapiz_pgdata:/cur -v rapiz_pgdata_pre_restore:/keep alpine sh -c 'cp -a /cur/. /keep/'
   docker run --rm -v rapiz_pgdrill:/from -v rapiz_pgdata:/to alpine sh -c \
     'find /to -mindepth 1 -delete && cp -a /from/. /to/ && rm -f /to/recovery.signal /to/.rapiz-restore-target'
   docker compose rm -sf pgdrill && docker volume rm rapiz_pgdrill
   ```
   When the restored database is confirmed good, `docker volume rm rapiz_pgdata_pre_restore`.
6. Pictures: `docker compose up -d object-storage`, create the bucket (`deploy.sh` does it too), then `docker compose run --rm backup rclone copy media:current src:rapiz --transfers 16`.
7. `docker login ghcr.io` with a token that can read packages, then `./deploy.sh <last good tag>` (the commit SHA of the newest `main`; images are tagged with it). Check sign-in, the inbox and a product picture.
8. Run `./backup-nightly.sh` once so the new server starts a fresh backup chain.

Record how long each step took in `backups/drills.log` (it is the real RTO).

## C. Pictures lost or damaged

```bash
# One object or a prefix (paths as in the bucket):
docker compose run --rm backup rclone copy media:current/<path> src:rapiz/<dir>
# Everything:
docker compose run --rm backup rclone copy media:current src:rapiz --transfers 16
# A version replaced or deleted on a given day:
docker compose run --rm backup rclone lsf -R media:deleted/2026-11-08
```

## D. Read a config archive (owner machine)

```bash
# With rclone configured for the bucket on your machine, or download the file from the provider console:
age -d -i age-key.txt 20261108T190000Z.tar.gz.age | tar -xzO .env
```

`age-key.txt` holds the `AGE-SECRET-KEY-…` line from the kit. Do this once a quarter to prove the kit still works.

## Alerts

`backup-check.sh` emails `BACKUP_ALERT_EMAIL` at most once an hour per alert (once a day for `not_configured`).

| Alert | Meaning | Do |
|---|---|---|
| `not_configured` | `BACKUP_S3_BUCKET` is empty | Switch it on (above) |
| `db_unreachable` | The check cannot query Postgres | `docker compose ps postgres`, logs |
| `wal_stuck` | WAL segments have waited more than 15 min to upload | Check the bucket (credentials, quota, provider status) and `docker compose logs postgres`. `pg_wal` grows until it works; watch the disk |
| `wal_failing` | The last WAL upload failed | Same as `wal_stuck` |
| `base_stale` | No base backup for 26 h | `backups/offsite.log`; run `./backup-nightly.sh` |
| `base_failed`, `retain_failed`, `media_failed`, `config_failed`, `prune_failed` | That nightly step failed | `backups/offsite.log`; fix and run `./backup-nightly.sh`. `media` refuses to sync when the source bucket has less than half the off-site objects (a lost or wrong bucket): restore pictures (section C), or if the shrink is real run `docker compose run --rm -e BACKUP_MEDIA_FORCE=1 backup media` |
| `drill_failed`, `drill_stale` | The last drill failed / none succeeded for 8 days | `backups/drills.log`; run `./restore-drill.sh`. A leftover `pgdrill` container makes the drill skip: `docker compose rm -sf pgdrill` when no restore is in progress |
| `disk_full` | Disk over 85 % | Free space (old images: `docker image prune`, old dumps) |
| `wal_dir_large` | `pg_wal` over 5 GiB | Usually `wal_stuck`; fix the upload |

## Testing changes to the scripts

`bash infra/deploy/test/backup-e2e.sh` (Docker needed, about 3 minutes) runs the real compose file and scripts against a second SeaweedFS as the off-site bucket: keys, WAL archiving, nightly, the encrypted local dump, `BACKUP_OBJECT_LOCK`, drill, point-in-time restore, alerts, unconfigured mode. Run it and `shellcheck` before changing anything in `infra/deploy` that touches backups.
