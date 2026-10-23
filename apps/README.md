# apps/

Deployable applications. Planned layout (see `docs/11-code-structure-and-conventions.md`):

| App | Purpose | Task |
|---|---|---|
| `api` | NestJS REST `/api/v1` + WebSocket | T-003 |
| `web` | Next.js dashboard (`app.<domain>`) | T-005 |
| `webhook` | Webhook ingress (verify, persist, enqueue) | later |
| `worker` | BullMQ processors | later |
| `widget` | Website chat widget | later |
| `admin` | Internal back-office | later |
| `site` | Marketing site + docs | later |

Each app has its own `README.md`, `package.json` with `dev/build/test/lint/typecheck` scripts, and validates its env at boot.
