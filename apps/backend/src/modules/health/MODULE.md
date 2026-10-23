# health

**Purpose:** operational endpoints — liveness (`/api/v1/health`), readiness (`/api/v1/health/ready`, 503 when a configured dependency is down), Prometheus `/metrics` (outside the prefix) and the OpenAPI document (`/api/v1/openapi.json`, built from `packages/contracts` route contracts).

**Owned tables:** none.

**Public API (`api/`):** none — nothing imports health.

**Events:** none.

**Invariants:** liveness never touches dependencies; readiness checks each configured dependency with a 1 s timeout (probes registered under `READINESS_PROBES`); metric labels use route templates only (no tenant ids, no raw URLs).

**Do not:** add business logic here.

**Test:** `pnpm --filter @agent-sales/backend test -- health`
