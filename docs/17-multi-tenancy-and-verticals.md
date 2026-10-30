# 17 — Multi-tenancy, vertical packs and horizontal scale

> Owner requirement (2026-10-23): ~1,000 tenants, each with its own business logic and assets, across very different industries (hotels, e-commerce shops, education centers, mechanical/solar companies, …). This document defines how the product stays **one codebase** while serving many verticals and scaling horizontally. Evidence on Preny comes from `preny-research/` (summary in §1); stack decisions in ADR-009; budgets in `docs/16`.

## 1. What Preny does today (evidence)

Preny markets **17 verticals** (fashion, restaurant, real estate, study abroad, travel, education, gym, hotel, dental, furniture, spa, photo studio, finance, beauty clinic, labor export, phone store, e-commerce). Thirteen of those pages are one template with three slots swapped: *entities the bot collects → desired outcome → where the human takes over*. Example rows:

| Industry | Entities collected | Outcome | Human role |
|---|---|---|---|
| Hotel | stay dates, room type, amenities, policies | room booking | staff or a system of record confirms the room |
| Education | course, tuition, schedule, trial class | enrolled student | consultant confirms class |
| Furniture | model, material, dimensions, style | showroom visit → order | sales confirms specs and delivery |
| Finance | product type, need, eligibility, documents | registration | specialist verifies eligibility |

In the product itself, the only industry-specific hooks observed are: (1) an industry picker in the bot wizard, (2) a seeded set of 6 FAQs + 3 scenarios whose answers are non-committal placeholders ("hỗ trợ nhiều hình thức thanh toán thông dụng"), (3) `?industry=` on three workflow templates. Everything else — inbox, CRM statuses/tags/rules, the physical-goods order form, carriers, integrations, pricing — is **one fixed UI**. There is no appointment, room, class, quote, menu or document object, no PMS/POS/LMS/calendar connector, and no public API. Research file: `docs/reference/preny-verticals.md` and `preny-research/07-so-do/08-cay-noi-dung-nganh.md`.

Conclusion: Preny's vertical story is prose. Ours must be **data and behavior**.

## 2. Design principles

1. **One codebase, one deployment, declarative verticals.** Industry differences are expressed as *vertical packs* (data + configuration + a small set of first-class business objects), never as forks or per-industry code paths in core modules.
2. **The triple is the unit of configuration.** Every pack defines *slot schema* (what to collect), *conversion events* (what counts as success and stops follow-up) and *handoff rules* (where the human takes over, what the bot must never decide).
3. **A small number of first-class objects covers most verticals.** Beyond `orders` (retail) we add `appointments` (scheduled services), `quotes` (long decisions, B2B, solar/mechanical) and `applications` (eligibility + documents: finance, study abroad, labor export). Everything else is custom fields on contacts or on these objects.
4. **Tenant assets are isolated, addressable and cheap to scale**: object storage prefix per workspace, vector index partitioned per bot, caches keyed by tenant, queues fair per tenant.
5. **Extensible by the tenant, safely**: custom fields, statuses, tags, workflows, prompts, knowledge and (later) API/webhooks — all inside the entitlement and RLS boundaries. No tenant can run code on our servers.

## 3. Vertical packs

A vertical pack is a versioned, seedable bundle maintained by us (back-office, `ADM-06`). Applying a pack to a workspace (at signup or later) seeds data the tenant then edits; it never locks the tenant in.

```
vertical_packs (key, version, name, industry_group, manifest JSONB)
manifest = {
  slots:        [{ key: 'stay_dates', type: 'date_range', required: true, ask: '…' }, …],   // what the bot collects
  conversions:  [{ key: 'appointment_confirmed', object: 'appointment', status: 'confirmed' }], // success events
  handoff:      { rules: ['clinical_advice', 'credit_decision'], message: '…' },                // human boundary
  guardrails:   ['never_promise_visa_outcome', 'no_medical_diagnosis'],
  knowledge:    { faqs: [{ q, a: 'Địa chỉ: {{store.address}} …' }], scenarios: [...], placeholders: ['store.address', 'hours'] },
  crm:          { statuses: [...], tags: [...], custom_fields: [...] },
  objects:      ['appointment'] | ['quote'] | ['order'] | ['application'],                    // which first-class objects/tools are enabled
  tools:        ['check_availability', 'create_appointment', 'search_products', …],
  workflows:    [{ template: 'soft-follow-up', copy: {...}, stop_on: ['appointment_confirmed'] }],
  kpis:         ['booking_rate', 'show_up_rate'] | ['quote_to_order'] | ['order_rate', 'repeat_rate'],
  catalog_kind: 'products' | 'services' | 'rooms' | 'courses' | 'menu' | 'projects' | 'spec_products'
}
```

**Placeholders are mandatory.** Seeded answers contain `{{placeholders}}`; the onboarding checklist does not reach "ready" until every placeholder used by seeded knowledge is filled (store address, hours, payment methods, deposit policy…). This fixes Preny's vague seeds.

### Industry groups and initial packs

| Group | Packs (initial) | Primary object | Conversion event | Typical tools |
|---|---|---|---|---|
| Retail & returning customers | e-commerce, fashion, phone/electronics, restaurant (menu + table request) | `order` (+ `appointment` for tables) | order confirmed / delivered; repeat order | `search_products`, `show_product`, `create_order_draft`, `get_customer_orders` |
| Scheduled services | dental, spa, beauty clinic, studio, gym, education center, hotel, travel | `appointment` (slot on a resource: chair, room, class, tour date) | appointment confirmed; attended/show-up; enrolled | `check_availability`, `create_appointment`, `reschedule`, `send_reminder` |
| Long decisions / quotes | furniture, real estate, **solar & mechanical (B2B)** | `quote` (configurable form + price rules) | quote accepted → order/contract | `collect_spec`, `estimate_price`, `create_quote`, `schedule_site_survey` |
| Eligibility & documents | finance, study abroad, labor export | `application` (checklist + documents) | application complete / submitted | `collect_document`, `check_eligibility` (rules), `handoff_specialist` |

Solar/mechanical example (the owner's case): slots = roof area or monthly kWh, roof type, province, grid/off-grid, budget; price rules = kWp from kWh, tiered price per kWp, options (battery, inverter brand); tools = `estimate_price` (deterministic, from the tenant's price table — never from the LLM), `create_quote` (PDF, versioned), `schedule_site_survey` (appointment); handoff = engineer validates before any binding price. B2B spec sheets, MOQ and lead time are custom fields on `products` with `catalog_kind: spec_products`.

## 4. First-class objects (additions to `docs/05`)

```sql
resources(id, workspace_id, kind: staff|room|chair|table|class|vehicle|tour_date, name, capacity, calendar JSONB, meta JSONB)
availability_rules(id, workspace_id, resource_id, rrule, slot_minutes, buffer_minutes, exceptions JSONB)
appointments(id, workspace_id, contact_id, conversation_id, resource_id, service_id, starts_at, ends_at, party_size,
             status: requested|confirmed|rescheduled|cancelled|attended|no_show, source, deposit JSONB, reminders JSONB,
             external_ref, idempotency_key UNIQUE)
services(id, workspace_id, name, duration_minutes, price, resource_kinds TEXT[], meta JSONB)        -- catalog_kind: services

quote_forms(id, workspace_id, name, fields JSONB)                                                   -- spec questions
price_rules(id, workspace_id, quote_form_id, expression JSONB, version)                             -- deterministic pricing
quotes(id, workspace_id, contact_id, conversation_id, form_id, inputs JSONB, lines JSONB, total, currency,
       status: draft|sent|accepted|rejected|expired, version, pdf_key, valid_until, approved_by, order_id)

applications(id, workspace_id, contact_id, conversation_id, kind, checklist JSONB, status: collecting|complete|submitted|approved|rejected, assignee_member_id)
application_documents(id, workspace_id, application_id, doc_type, storage_key, status: pending|received|verified|rejected, note)

custom_field_definitions(id, workspace_id, object: contact|order|appointment|quote|application|product, key, type, options JSONB, required, position)
workspace_packs(workspace_id, pack_key, pack_version, applied_at, placeholders JSONB)
conversion_events(…)   -- extend existing table: order_confirmed, appointment_confirmed, attended, enrolled, quote_accepted, application_submitted
```

All objects: `workspace_id` + RLS, UUIDv7, idempotent creation from chat, snapshotting of prices, timeline entries on the contact, and each becomes a **stop condition for workflows** and a **conversion event for ad attribution** (CAPI `Schedule`, `Lead`, `Purchase`, `SubmitApplication`).

Catalog: one `products` master (ADR-009 keeps the "single catalog" decision) with `catalog_kind` per workspace; rooms/courses/menu items are products with kind-specific custom fields and optional links to `resources`.

## 5. Per-tenant extensibility (what a tenant can change without us)

| Area | Mechanism | Limits / safety |
|---|---|---|
| Bot behavior | mission, scenarios, per-product instructions, classification prompt, handoff template, guardrail toggles from the pack | prompts are *data* inside our system prompt frame; injection-safe delimiters |
| Knowledge & assets | FAQs, documents, URLs, media albums → `ws/{workspace_id}/…` in object storage; vector chunks keyed by `bot_id` | quotas by plan (`docs/08`); per-tenant index partition; signed URLs |
| Data model | custom fields on 6 objects; custom statuses, tags with attribute schemas, sources, segments | JSONB validated against `custom_field_definitions`; indexed via expression indexes when filtered |
| Processes | workflow templates (pack-provided) with tenant copy, timings and stop conditions; later a general builder | per-tenant concurrency and daily send caps |
| Pricing logic | price rules as data (expressions evaluated by us, no code), quote forms | deterministic; versioned; approval before binding |
| Integrations | their own channels, carriers, Google Sheet; **public API + webhooks (P2)** for PMS/LMS/POS/ERP | API keys scoped per workspace, rate limited |
| Team | roles, scopes, assignment rules | RBAC (`docs/09`) |
| Tenant code | **not supported** (no scripts/plugins on our servers) | — |

## 6. Horizontal scaling model

```mermaid
flowchart LR
  CDN[CDN: SPA + media] --> LB[Load balancer, sticky WS]
  LB --> API1[api ×N stateless]
  LB --> WH[webhook ×N stateless]
  API1 & WH --> RQ[(Redis: queues per class, group per workspace)]
  RQ --> W1[worker: conversation ×N]
  RQ --> W2[worker: outbound ×N]
  RQ --> W3[worker: campaign/workflow ×N]
  API1 & W1 & W2 & W3 --> PGB[PgBouncer]
  PGB --> PG[(Postgres primary<br/>partitioned by month<br/>RLS by workspace)]
  PG --> RR[(read replica: analytics, exports)]
  PG -. tenant tier L .-> PGD[(dedicated DB for very large tenants<br/>routed by workspace)]
  W1 --> LLM[LLM gateway: pooled provider limits]
  API1 & W1 --> S3[(Object storage ws/{id}/…)]
```

- **Stateless compute everywhere** (`api`, `webhook`, `worker`): scale by replicas; no local disk; config from env; sticky sessions only for WebSocket.
- **Tenant-keyed everything**: every row, cache key, queue job, storage key, log line and metric carries `workspace_id`. This is what makes later sharding possible without rewriting code.
- **Queue fairness**: implemented by us (open-source BullMQ has no per-group limits): a Redis token bucket per `workspace_id` (and per `channel_connection_id` for sends) checked at job start, over-budget jobs re-delayed with jitter, separate queues per class (`agent`, `outbound`, `campaign`, `indexer`) and per tier (`std`/`priority`) with weighted workers — so a campaign of one tenant cannot delay another's customer replies. Decision gate at Beta: Trigger.dev/Temporal if durable multi-step flows outgrow BullMQ (ADR-003).
- **Database tiers**: S/M tenants share the primary (forced RLS, `withTenant()`); analytics and exports read the replica; `messages` may be hash-sub-partitioned by `workspace_id` when a single table becomes the bottleneck. A `tenant_routes(workspace_id, database_key)` table exists from the first migration so that moving an L tenant (e.g. > 2 M contacts or > 50 k messages/day) to a **dedicated database** later is a routing update plus logical replication — but the multi-database migration runner, DI resolution and cross-DB constraints are **not built until the first such tenant exists** (a later ADR). Citus is the alternative if many tenants grow at once.
- **Vectors**: most SME bots have < 10 k chunks, so retrieval uses a plain `(bot_id)` btree and an exact scan by default (no recall loss from post-filtered HNSW); a partial HNSW index is added only for bots above a threshold, with pgvector ≥ 0.8 iterative scans. Embeddings are stored per model (`knowledge_embeddings_<model>` or `halfvec` with the model's dimension) so switching embedding models (ADR-005) does not force a rebuild of one fixed `VECTOR(1536)` column. Very large bots can move to a dedicated vector store behind the same retrieval interface.
- **Assets**: object storage scales linearly; CDN in front; lifecycle to cold storage after 12 months; per-tenant byte accounting for quotas.
- **Caches**: Redis keys `ws:{id}:…`; entitlements and pack manifests cached with short TTL; no cross-tenant cache entries.
- **Limits per tenant** (API, AI calls, sends, storage) from entitlements, enforced in middleware, visible on the usage page.
- **Multi-region** is not planned before 1,000 tenants; data residency per tenant (VN vs SG) can be met with the same router if required.

## 7. Impact on requirements and roadmap

- `docs/02` gains module **VRT** (vertical packs & objects) — see table there; P0 = retail pack + "appointment request" (no calendar); P1 = `appointments` with resources/availability, `quotes` v1 (form + price rules + PDF), pack manifests and placeholders, conversion events for services; P2 = `applications`, public API/webhooks, pack marketplace in back-office.
- `docs/05` adds the tables in §4. `docs/06` tools list gains `check_availability`, `create_appointment`, `estimate_price`, `create_quote`, `collect_document`.
- T-004 (`packages/db`) must include the workspace→connection router and partitioning from the first migration.
- Pack content (seed FAQs, scenarios, workflow copy, KPIs) is product work owned by the Product Owner and the chatbot trainer; engineering ships the mechanism.


## Current lodging slice (T-155)

One whole property can now carry accommodation metadata and staff-confirmed stay requests inside commerce. This bounded implementation precedes the generic resource/appointment architecture described above; it is not a PMS/external calendar. See [ADR-013](adr/ADR-013-lodging-catalog-and-stay-requests.md) and [lodging operations](lodging.md).

## Current SaaS slice (ADR-014)

Industry `saas` has its own built-in customer statuses, a tier-2 module `saas` (customer subscriptions) and the first per-vertical bot tool, a built-in `builtin.saas.request` action routed in-process that records a demo / trial request on the customer. See [ADR-014](adr/ADR-014-saas-vertical-requests-subscriptions-builtin-tool.md) and [SaaS businesses](saas.md).
