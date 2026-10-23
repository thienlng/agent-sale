# 14 — Open Decisions & Questions to Finalize

> Each item has a **default proposal** — if there is no feedback, the project team proceeds with the proposal. Record the final outcome in the corresponding ADR.

## A. Business & product (PO / project owner)

| # | Question | Default proposal | Impact |
|---|---|---|---|
| A1 | Brand name, domain name? | **Decided 2026-10-23: Razpi** (working name; domain still open). Visual identity: white base, orange primary. Code package scope stays `@agent-sales/*` so a rename never touches imports | Marketing site, Meta App, Zalo App |
| A2 | Priority ICP for the MVP? | ICP A (shops running click-to-message ads: fashion/cosmetics) | Industry templates, channels, order features |
| A3 | Priority channels for the MVP? | Facebook Messenger + Zalo OA + Website widget | Phase 1 |
| A4 | Pricing & plans: copy Preny or price differently? | Keep the 3-plan structure + Free + AI wallet; prices decided by the business after interviewing 10–15 shops | Billing seed |
| A5 | Does the Free plan include AI messages, and what cycle? | Yes, 500–1,000 messages/14 days, 1 channel, lock the widget? (Preny locks the widget on Free) | Unbilled AI costs |
| A6 | Sell setup/script optimization services? | Yes, as a one-time add-on | CS/trainer team |
| A7 | Support resellers/agencies (multi-workspace) early? | Phase 4 | Architecture already supports it |
| A8 | Bot language: Vietnamese only or multilingual? | Vietnamese + English from the start (LLMs support it out of the box), UI vi/en | Eval |

## B. Technical (Tech lead)

| # | Question | Default proposal | ADR |
|---|---|---|---|
| B1 | Backend language/framework | TypeScript + NestJS modular monolith | ADR-001 |
| B2 | Database | PostgreSQL 16 + pgvector (no Mongo) | ADR-002 |
| B3 | Queue | Redis + BullMQ; revisit Kafka/Temporal when > 1,000 msg/s or workflows become complex | ADR-003 |
| B4 | Multi-tenant | Shared schema + `workspace_id` + RLS | ADR-004 |
| B5 | LLM provider | Multi-provider via a gateway; choose the model for each tier using Vietnamese evals | ADR-005 |
| B6 | Hosting & data region | **Decided 2026-10-23: self-hosted only** (no cloud Postgres/Grafana/Langfuse). Remaining choice: Vietnamese data center / colocation vs IaaS VMs (VN or SG) — all self-managed | ADR-006 |
| B7 | Build auth in-house or use a service | Build in-house (need control over workspace/role; per-MAU cost of external services is high at scale) | ADR-007 |
| B8 | Credit unit | 1 credit = 1,000 VND, stored as milli-credit (bigint) | ADR-008 |
| B9 | Quick replies at bot level (like Preny) or workspace level? | Workspace | — |
| B10 | ORM: Prisma or Drizzle? | Drizzle (close to SQL, easy control over partitioning/RLS) — or Prisma if the team is already familiar with it | ADR-001 |
| B11 | Mobile app? | Phase 4; until then responsive dashboard + PWA notifications | — |

## C. Legal & partners

| # | Question | Notes |
|---|---|---|
| C1 | Legal entity to sign contracts with Meta/Zalo/VNPAY/e-invoice (HĐĐT) provider? | Needed before Phase 0 week 1 |
| C2 | Cross-border data transfer when calling LLMs: dossier required under the Personal Data Protection Law (Luật Bảo vệ dữ liệu cá nhân)? | Lawyer to advise; consider providers with a suitable processing region |
| C3 | Carrier (COD) contracts signed by the shop directly or do we act as an agent? | Proposal: shops sign directly, we only connect the API |
| C4 | Collecting ZBS/SMS fees: revenue or collection on behalf? | Accountant to advise; affects invoicing |

## D. Unknowns about Preny (not blocking the project)

From `reference/preny-dashboard-spec.md` §15: inbox layout, bot creation wizard, workflow step details, permission matrix, carrier list, ZBS pricing, voucher effects, ticket form… → **we design these ourselves** according to [02](02-functional-requirements.md); if deeper comparison is needed, open a paid Preny account for 1 month to survey it (a small cost compared with the risk of a wrong design) — survey only, do not copy.
