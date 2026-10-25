# Project Documentation — AI Sales Agent (Preny clone)

> **Status: design baseline (draft, 2026-10-23).** Written before any product code existed. It describes the *intended* design; code and tests describe reality. Working rules for contributors live in [`/AGENTS.md`](../AGENTS.md) and [`.agents/rules/`](../.agents/rules/) and take precedence over anything here. Update these docs in the same PR as the change they describe (Rule 06). Open questions are tracked in [14-open-decisions.md](14-open-decisions.md) and task `T-002`.

Project kickoff documentation set: analysis, specifications and plans for building a **production-ready, broadly deployable** product, functionally equivalent to Preny (preny.ai) and improving on the weaknesses identified in our research.

Input source: `../../preny/preny-research/` (Preny research dossier dated 23/10/2026: 142 public URLs, 75 real dashboard screens, 18 test cases, pricing & credits). We learn features and flows from it only; no Preny code, UI, brand or content is copied.

## Reading order

| # | Document | Audience | Content |
|---|---|---|---|
| 01 | [Product overview & strategy](01-product-overview.md) | Everyone | What Preny is, positioning, ICP, "clone + surpass", success metrics |
| 02 | [Functional requirements (PRD)](02-functional-requirements.md) | PO, dev, QA | ~150 features with IDs, P0–P3 priorities, acceptance criteria, NFRs |
| 03 | [Screen & route map](03-screens-and-routes.md) | FE, designer | Mapping Preny routes → our routes, inbox wireframe |
| 04 | [System architecture](04-system-architecture.md) | Tech lead, BE | Stack, modules, message flow, realtime, multi-tenancy |
| 05 | [Data model](05-data-model.md) | BE | PostgreSQL schema, order formulas, data rules |
| 06 | [AI Engine](06-ai-engine.md) | AI, BE | Pipeline, retrieval, tools, guardrails, model tiers, eval |
| 07 | [Channel & partner integrations](07-channel-integrations.md) | BE | Meta, Zalo, widget, TikTok, Lazada, carriers, payments |
| 08 | [Plans, quota, credits & payments](08-billing-quota-credit.md) | PO, BE | Entitlements, ledger, wallet, subscriptions, affiliate |
| 09 | [Security & compliance](09-security-and-compliance.md) | Tech lead, legal | Auth, RBAC, RLS, audit, personal data protection (BVDLCN) law |
| 10 | [Infrastructure & operations](10-operations-and-deployment.md) | DevOps | Environments, CI/CD, observability, SLOs, DR |
| 11 | [Code structure & conventions](11-code-structure-and-conventions.md) | Dev | Monorepo, API, coding standards, Definition of Done |
| 12 | [Roadmap & plan](12-roadmap-and-plan.md) | Everyone | Team, Phases 0–4, sprints, exit criteria, risks |
| 13 | [Testing & quality](13-testing-and-quality.md) | QA, AI | Test pyramid, AI eval suite, critical business cases |
| 14 | [Open decisions](14-open-decisions.md) | Project owner | Questions to finalize + default proposals |
| 15 | [Team workflow](15-team-workflow.md) | Humans | How two maintainers run many agents: roles, cadence, review policy, Phase 0 plan |
| 16 | [Performance & scale](16-performance-and-scale.md) | Everyone | Binding budgets for "fast, smooth, modern", mandatory patterns, scale plan to ~1,000 tenants |
| 17 | [Multi-tenancy & verticals](17-multi-tenancy-and-verticals.md) | PO, architects | Vertical packs (hotel, education, solar/mechanical, …), first-class objects (appointments, quotes, applications), per-tenant extensibility, horizontal scaling model |
| — | [ARCHITECTURE.md](ARCHITECTURE.md) | Everyone writing code | Where code goes, the fixed module shape, allowed imports, enforcement, generators — mandatory before any code change |
| — | [ADR](adr/README.md) | Tech lead | 9 architecture decisions |
| — | [Architecture research 2026-10-23](reference/2026-10-23-architecture-research.md) | Reference | Survey of agent-friendly code organization that ARCHITECTURE.md is based on |
| — | [Preny dashboard specification](reference/preny-dashboard-spec.md) | Reference | Each screen, field, column, button, observed limit |
| — | [Preny industry verticals](reference/preny-verticals.md) | Reference | 17 verticals, how (little) the product differs per industry, gaps we exploit |
| — | [Stack review 2026-10-23](reference/2026-10-23-stack-review.md) | Reference | Independent adversarial review of ADR-009 (17 findings) that drove the revisions |
| — | [Best practices 2026-10-23](reference/2026-10-23-best-practices.md) | Reference | Survey of current production practices (multi-tenancy, queues, LLM agents, frontend, realtime, backend, agent-operated repos) |
| — | [Training workspace](training-workspace.md) | Implementation | Bot training materials, history and handover settings (T-045) |
| — | [Meta inbox](meta-inbox.md) | Implementation | Facebook/Instagram connection, webhook processing, takeover, attachments and live testing (T-045) |

## One-page summary

- **Product:** multichannel AI sales bot (FB, IG, Zalo, TikTok, Lazada, website) + inbox for sales staff + Mini CRM + orders/shipping + remarketing (ZBS, FMM, email) + follow-up workflows + plans/credit wallet + affiliate.
- **Stack:** TypeScript monorepo · Vite + React SPA (dashboard) · Astro (site) · NestJS on Fastify modular monolith (api/webhook/worker) · PostgreSQL + pgvector · Redis + BullMQ · S3 · multi-provider LLM gateway · OpenTelemetry/Grafana/Sentry/Langfuse · Docker → Kubernetes.
- **Differentiators:** one shared catalog for the bot & orders; transparent answer sources; complete handoff; real audit; sandbox that does not pollute metrics; GHN/GHTK; ROI measurement from ads → orders.
- **Plan:** Phase 0 (2 weeks) → MVP (10 weeks, alpha with 5–10 shops) → Beta (8 weeks, 30–50 paying shops) → GA (8 weeks of hardening) ≈ 7 months with a team of 9–10 people.
- **Immediate actions:** finalize the [open decisions](14-open-decisions.md), submit Meta Business Verification/App Review + Zalo app, interview shops, scaffold the repo.

- [Facebook post/comment automation](integrations/facebook-comments.md) — T-069 configuration, source context, moderation policy, delivery guarantees and provider verification limits.

## Documentation conventions

- Living documents: update them in the same PR when behavior/architecture changes.
- The **[+]** marker = improvement over Preny; feature IDs (`BOT-07`, `ORD-03`…) are used in the backlog and commits.
- Preny figures are a snapshot as of 23/10/2026, for reference only.
