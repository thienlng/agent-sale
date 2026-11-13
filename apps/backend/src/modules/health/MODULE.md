# health

**Purpose:** operational endpoints — liveness (`/api/v1/health`; the build version only outside production), readiness (`/api/v1/health/ready`, 503 when a configured dependency is down), Prometheus `/metrics` (outside the prefix) and the OpenAPI document (`/api/v1/openapi.json`, built from `packages/contracts` route contracts; in production it serves the public API subset, the same as `/api/v1/public/openapi.json`). Readiness, the internal OpenAPI and `/metrics` are not reachable through the production edge (`infra/deploy/Caddyfile`); use the container network.

**Owned tables:** none.

**Public API (`api/`):** none — nothing imports health.

**Events:** none.

**Invariants:** liveness never touches dependencies; readiness checks each configured dependency with a 1 s timeout (probes registered under `READINESS_PROBES`); metric labels use route templates only (no tenant ids, no raw URLs).

**Do not:** add business logic here.

**Test:** `pnpm --filter @agent-sales/backend test -- health`
