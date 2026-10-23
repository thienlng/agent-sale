# health

**Purpose:** liveness/readiness for load balancers and uptime checks. The minimal example of an interface-only module.

**Owned tables:** none.

**Public API (`api/`):** none — nothing imports health.

**Events:** none.

**Invariants:** `GET /api/v1/health` never touches the database; readiness (`/health/ready`, later) does.

**Do not:** add business logic here.

**Test:** `pnpm --filter @agent-sales/backend test -- health`
