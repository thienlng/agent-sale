# ADR-028: Backup and disaster recovery on a single VPS

- Status: Proposed
- Date: 2026-11-08
- Decision makers: owner (mrkenknight), maintainer review (thienlng)

## Context

Production runs on one VPS with Docker Compose (`infra/deploy/`). The only backup is a daily `pg_dump` kept on the same disk for 14 days: losing the server loses the data and its backups, the RPO is up to 24 hours, object storage (all pictures and media) and the server secrets (`.env`) are not backed up at all, and no restore has ever been tested. `docs/02-functional-requirements.md` requires RPO ≤ 15 minutes, RTO ≤ 4 hours and restore-tested backups. `docs/10-operations-and-deployment.md` describes the multi-node target (Patroni + pgBackRest), which does not fit one server. The owner has not chosen an off-site storage provider.

## Decision

1. **PostgreSQL**: continuous WAL archiving with **WAL-G** (`archive_timeout = 60`, libsodium encryption, zstd) plus a nightly base backup; 30 full backups retained, giving point-in-time recovery over 30 days and RPO ≤ 1 minute. WAL-G ships in a project postgres image built on `pgvector/pgvector:pg16`.
2. **Object storage**: nightly `rclone sync` to an rclone `crypt` remote, with overwritten/deleted objects kept 30 days via `--backup-dir`.
3. **Server config** (`.env`, compose files): nightly tarball encrypted with **age** to a public key; the private key never lives on the server.
4. **Destination**: any S3-compatible bucket, configured by `BACKUP_S3_*`; no provider is assumed. Unconfigured is a supported state in which nothing changes.
5. **Verification**: a weekly automated restore drill into a throwaway container records the real database RTO; a 5-minute check emails alerts (stale WAL archiving, stale base backup, failed nightly step or drill, disk / `pg_wal` growth).
6. The decryption keys form a break-glass kit kept by the owner outside the server.
7. Redis, the Hermes volume and Caddy volumes are not backed up.

Details: [design spec](../superpowers/specs/2026-11-08-backup-and-data-export-design.md) §Phase 1.

## Options considered

- **Hourly `pg_dump` + restic off-site** — simplest, but RPO ~1 hour, no point-in-time recovery, and dumps grow heavier with the database. Rejected: orders, lodging holds and conversations change continuously.
- **WAL-G** (chosen) — one static binary in the postgres image, native S3, encryption and retention; fits one host.
- **pgBackRest + Patroni** (the `docs/10` target) — strongest, but needs a repository host / multiple nodes and more operations than one VPS justifies. It remains the target when production moves to the multi-node layout; WAL-G will then be replaced and this ADR superseded.
- **restic for media** instead of rclone crypt — similar safety; rclone keeps the off-site copy browsable object by object (single-file restore without a repository index) and needs one tool for media and config.

## Consequences

- Postgres gains outbound network access (the compose `default` network) to upload WAL; it still publishes no port.
- Postgres must restart once to turn archiving on, and the postgres image becomes a project image (`infra/deploy/postgres`, built on the server) that must be rebuilt when WAL-G, rclone or pgvector are upgraded. WAL-G is pinned to v3.0.7, the newest release that ships Postgres binaries.
- If the destination is unreachable for long, WAL accumulates in `pg_wal` and can fill the disk; the check alerts at 5 GB / 85 % disk well before that.
- Restores depend on the owner keeping the break-glass kit; losing it makes the off-site backups unreadable.
- The off-site provider becomes a (cheap) external dependency for backups only; no live service depends on it, so the self-hosting constraint for running services holds.
- The local `pg_dump` remains for fast on-host restores and now runs before every deploy; retention drops to 7 days once off-site backups are configured.
- The first deploy of this change recreates Postgres on the project image; a failure there has no automatic rollback (the previous release uses the same compose file), so it is rolled out by hand in a quiet window after building the image on the server.
