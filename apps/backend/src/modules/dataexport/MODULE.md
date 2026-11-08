# dataexport

**Purpose:** whole-workspace data export (SET-10): an owner or admin asks for a ZIP of all the business's data, the worker builds it, and they download it once per link for 7 days. Spec: `docs/superpowers/specs/2026-11-08-backup-and-data-export-design.md` Phase 2.

**Owned tables:** `data_exports` (migration 0070; schema in `packages/db/src/schema/dataexport.ts`).

**Public API (`api/`):**
- `DATAEXPORT_RUNNER` → `DataExportRunner.tick()`: run by the `worker` entry every 10 s (expire old files, build one queued export).
- HTTP: `GET/POST /data-exports`, `POST /data-exports/{id}/link` (capability `data.export`, owner and admin), `GET /data-exports/download/{token}` (public; the one-time token is the credential).

**Consumes:** the `<MODULE>_EXPORT` sources of `workspace`, `crm`, `conversation`, `commerce`, `knowledge`, `lodging`, `bot` and `saas` (each module declares its own files and columns with `exportTable()` from `@agent-sales/db`); `workspace` (business name, members, account), `identity` (member names and emails for `people.csv`) and `notification` (`dataexport.ready` / `dataexport.failed`, in-app and email).

**Invariants:**
- One queued or running export per business; at most 3 requests per business per 24 hours.
- Archives go to the private exports bucket (`S3_EXPORT_BUCKET`, default `<S3_BUCKET>-exports`), never the public media bucket; files expire after 7 days.
- A download link is 32 random bytes, stored only as its SHA-256, valid 5 minutes and once.
- Every request and download writes an audit event (`workspace.data_exported`, `workspace.data_export_downloaded`).
- Never exported: secrets, tokens, password or key material. Logs carry ids, sizes and error codes only.

**Do not:** read other modules' tables (ask their export source); put export files in the media bucket; hand out object-store URLs.

**Test:** `pnpm --filter @agent-sales/backend test -- dataexport`; HTTP + Postgres: `apps/backend/test/data-export.integration.spec.ts`.
