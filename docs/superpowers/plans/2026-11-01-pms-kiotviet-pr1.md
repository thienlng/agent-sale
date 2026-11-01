# PMS integration with KiotViet — PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace connects its KiotViet store from a new "Tích hợp PMS" page; products, pictures and
stock of the chosen branches are mirrored into the Rapiz catalog (full import, webhooks, 10-minute
reconcile) and the mirrored fields are read-only in Rapiz.

**Architecture:** New tier-3 backend module `integration` (KiotViet client, connection service, lease-based
sync jobs run by the worker tick) writing the catalog only through a new commerce `CATALOG_SYNC_FACADE`.
`apps/webhook` stores raw KiotViet deliveries; the worker verifies and applies them. New web feature
`integration` (hub, 3-step wizard, connection view) plus badges/locks in the products UI.

**Tech Stack:** NestJS 12 on Fastify, Drizzle + hand-written SQL migrations, Postgres RLS, Zod contracts,
Vite + React 19, TanStack Router/Query, shadcn/ui, react-i18next, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-pms-kiotviet-design.md` (read it first; §-references below
point into it). Decision record: `docs/adr/ADR-017-external-source-of-truth-pms.md`.

## Global Constraints

- Work only in the worktree `/home/kenknight/Workspace/agent-sale-kiotviet`, branch `feat/pms-kiotviet`.
- Repo rules: `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md`. English for code, comments, commits;
  Vietnamese only in `packages/i18n` vi messages. Conventional Commits, each ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never create a module by hand: `pnpm gen module integration`, `pnpm gen feature integration`.
- Other modules import only `modules/<x>/api/**`; every constructor parameter uses `@Inject(TOKEN)`.
- Money is integer VND. Never log secrets, tokens, or customer data (rule 07) — log codes and counts.
- KiotViet: token `POST https://id.kiotviet.vn/connect/token` (form: `scopes=PublicApi.Access`,
  `grant_type=client_credentials`, `client_id`, `client_secret`); API base `https://public.kiotapi.com`,
  headers `Retailer`, `Authorization: Bearer`; `pageSize` ≤ 100 with `currentItem`; budget 4 500 req/h per
  store; webhook signature HMAC-SHA256 of the raw body in `X-Hub-Signature`.
- UI name: **"Tích hợp PMS"** (en: "PMS integrations"), route `/app/integrations`, icon lucide `Blocks`.
- Migration number: `0040_pms_integration.sql` (check `ls packages/db/migrations` first; if 0040 is taken on
  `origin/main`, take the next free number).
- Each task ends with its tests green and `pnpm --filter <pkg> typecheck` clean; the last task runs
  `pnpm check`.

## File structure

```
packages/db/migrations/0040_pms_integration.sql            new tables + commerce link columns + RLS
packages/db/src/schema/integration.ts                       Drizzle schema of integration tables
packages/db/src/schema/commerce.ts                          + external link columns
packages/contracts/src/integration/integration.schema.ts    DTOs (connection, test result, log, settings)
packages/contracts/src/integration/integration.routes.ts    route contracts
packages/contracts/src/commerce/commerce.schema.ts          ProductDto.external, list filter `source`
apps/backend/src/modules/commerce/api/catalog-sync.facade.ts            CATALOG_SYNC_FACADE
apps/backend/src/modules/commerce/application/catalog-sync.service.ts   implementation
apps/backend/src/modules/commerce/domain/external-lock.ts               locked-field rules (pure)
apps/backend/src/modules/integration/                       new module (generator)
  domain/kiotviet-mapping.ts        KiotViet products → ExternalCatalogItem
  domain/stock.ts                   available per variant over sale branches
  domain/signature.ts               HMAC check
  domain/retailer.ts                parse "Tên gian hàng" input
  domain/connection-errors.ts       typed errors (§8 of the spec)
  application/connection.service.ts test / connect / update / sync now / disconnect / list / log
  application/sync.service.ts       full import, reconcile, webhook apply
  application/sync-runner.ts        the worker tick (claims jobs, schedules reconcile)
  application/ports/*.ts            KiotVietGateway, IntegrationStore
  infrastructure/clients/kiotviet-client.ts   HTTP client (token cache, budget, retries)
  infrastructure/clients/kiotviet.schemas.ts  tolerant Zod schemas of KiotViet payloads
  infrastructure/persistence/integration.drizzle-store.ts
  interface/http/integration.controller.ts
apps/backend/src/entries/worker.ts                           + IntegrationModule tick
apps/webhook/src/kiotviet-route.ts (+ store)                 POST /webhooks/kiotviet/:token
apps/web/src/features/integration/{api,components}           hub, wizard, connection view
apps/web/src/routes/app/integrations/{index,kiotviet}.tsx
apps/web/src/components/layout/app-sidebar.tsx               + "Tích hợp PMS"
apps/web/src/features/commerce/components/{products-list,product-form}.tsx   badge, bar, hint, locks
packages/i18n/src/messages/{vi,en}/integration.json          strings
docs/…                                                       see Task 12
```

---

### Task 1: Database — integration tables and commerce link columns

**Files:**
- Create: `packages/db/migrations/0040_pms_integration.sql`, `packages/db/src/schema/integration.ts`
- Modify: `packages/db/src/schema/commerce.ts` (products, product_variants, orders), `packages/db/src/schema/index.ts`
- Test: `apps/backend/test/integration-tables.integration.spec.ts` (copy the tenant-isolation style of an existing `*.integration.spec.ts` that checks RLS, e.g. grep `cross-tenant` / `withTenant` in `apps/backend/test`)

**Interfaces — Produces:** Drizzle tables `integrationConnections`, `integrationJobs`,
`integrationWebhookEvents`, `integrationImageCache`, `integrationSyncLog`; commerce columns
`products.externalSource/externalId`, `productVariants.externalId`, `orders.external*` (orders columns are
added now so PR 2 needs no migration; unused in PR 1).

- [ ] **Step 1: Write the migration** (pattern: `packages/db/migrations/0039_bot_orders.sql` for RLS and grants)

```sql
-- PMS integration (ADR-017): connections, lease jobs, raw webhook deliveries, picture cache, sync log,
-- and external link columns on the catalog and orders.
create table integration_connections (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (provider in ('kiotviet')),
  status text not null check (status in ('connected','syncing','error','disconnected')),
  retailer text not null,
  client_id text not null,
  client_secret_sealed text not null,
  webhook_token text not null unique,
  webhook_secret_sealed text not null,
  settings jsonb not null,
  version integer not null default 1,
  progress jsonb,
  counts jsonb not null default '{}'::jsonb,
  last_error jsonb,
  last_full_sync_at timestamptz,
  last_reconcile_at timestamptz,
  connected_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz
);
create unique index integration_connections_live on integration_connections (workspace_id, provider)
  where status <> 'disconnected';

create table integration_jobs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  -- push_order / customer_import are used from PR 2 / PR 3; allowed now so they need no migration.
  kind text not null check (kind in ('full_import','reconcile','webhook','push_order','customer_import')),
  payload jsonb not null default '{}'::jsonb,
  cursor jsonb,
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  claim_token uuid,
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);
create index integration_jobs_ready on integration_jobs (run_after) where done_at is null and failed_at is null;
create unique index integration_jobs_one_sync on integration_jobs (connection_id)
  where kind in ('full_import','reconcile') and done_at is null and failed_at is null;

create table integration_webhook_events (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  delivery_id text not null,
  body text not null,
  signature text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id, delivery_id)
);
create index integration_webhook_events_open on integration_webhook_events (received_at) where processed_at is null;

create table integration_image_cache (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_url text not null,
  stored_url text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, source_url)
);

create table integration_sync_log (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  level text not null check (level in ('info','warning','error')),
  code text not null,
  params jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index integration_sync_log_recent on integration_sync_log (connection_id, at desc);

alter table products add column external_source text, add column external_id text;
create unique index products_external on products (workspace_id, external_source, external_id)
  where external_id is not null;
alter table product_variants add column external_id text;
create unique index product_variants_external on product_variants (workspace_id, external_id)
  where external_id is not null;
alter table orders
  add column external_source text, add column external_id text, add column external_code text,
  add column external_status text,
  add column external_state text check (external_state in ('pending','pushed','failed')),
  add column external_error jsonb, add column external_pushed_at timestamptz;
```

Then, for each of the five new tables, the exact RLS block used in 0039 (`enable` + `force row level
security`, `<t>_tenant` policy to `app_tenant`, `<t>_system` policy to `app_system`) and the grants 0035 uses
(`grant select, insert, update, delete on <t> to app_tenant`; check 0039 for whether `app_system` also gets
grants and copy it).

- [ ] **Step 2: Mirror it in Drizzle** — `schema/integration.ts` with `tenantPolicies(table)` (see
  `schema/workspace.ts:28-43`) and the same columns; add link columns to `schema/commerce.ts`; export from
  the schema index.
- [ ] **Step 3: Write the isolation test** — two workspaces; inserting/reading each new table under
  `withTenant(ws A)` never sees ws B rows; `webhook_token` unique across workspaces.
- [ ] **Step 4: Run** `pnpm db:migrate` against the dev database after a `pg_dump` backup to
  `~/Workspace/rapiz-backups/` (memory: compare all migration files with `schema_migrations` first), then
  `pnpm --filter @agent-sales/backend test -- integration-tables` → PASS.
- [ ] **Step 5: Commit** `feat(db): integration tables and external link columns for the PMS sync`

### Task 2: Contracts

**Files:**
- Create: `packages/contracts/src/integration/integration.schema.ts`, `integration.routes.ts`, `integration.schema.test.ts`
- Modify: `packages/contracts/src/index.ts` (export + append routes to `allRoutes`), `packages/contracts/src/commerce/commerce.schema.ts` (`ProductDto` line 139, `ProductListQuery` line 201)

**Interfaces — Produces:**

```ts
export const PmsProvider = z.enum(['kiotviet', 'sapo', 'haravan', 'pancake_pos']);
export const ConnectionStatus = z.enum(['connected', 'syncing', 'error', 'disconnected']);
export const KiotVietSettings = z.object({
  saleBranchIds: z.array(z.number().int().positive()).min(1).max(50),
  orderBranchId: z.number().int().positive(),
  pushOrders: z.boolean(),
  syncCustomers: z.boolean(),
}).refine((s) => s.saleBranchIds.includes(s.orderBranchId), { path: ['orderBranchId'] });
export const KiotVietCredentials = z.object({
  retailer: z.string().trim().min(1).max(200),   // raw input; the server extracts the name (domain/retailer.ts)
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(500),
});
export const KiotVietBranch = z.object({ id: z.number().int(), name: z.string(), address: z.string().nullable() });
export const KiotVietTestResponse = z.object({
  retailer: z.string(),
  branches: z.array(KiotVietBranch),
  preview: z.object({ matched: z.number().int(), created: z.number().int(), rapizOnly: z.number().int() }),
});
export const ConnectKiotVietRequest = KiotVietCredentials.extend({ settings: KiotVietSettings });
export const UpdateKiotVietRequest = z.object({
  settings: KiotVietSettings.optional(),
  credentials: KiotVietCredentials.optional(),          // "Cập nhật mã" after a rotation
  version: z.number().int(),
});
export const SyncProgress = z.object({ phase: z.enum(['branches','categories','products','stock']), done: z.number().int(), total: z.number().int().nullable() });
export const ConnectionDto = z.object({
  id: z.string().uuid(), provider: z.literal('kiotviet'), status: ConnectionStatus,
  retailer: z.string(), clientIdMasked: z.string(),
  settings: KiotVietSettings, branches: z.array(KiotVietBranch),
  counts: z.object({ products: z.number().int(), customers: z.number().int(), ordersPushed: z.number().int() }),
  progress: SyncProgress.nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  lastError: z.object({ code: z.string(), at: z.string().datetime() }).nullable(),
  version: z.number().int(),
});
export const IntegrationListResponse = z.object({
  providers: z.array(z.object({ provider: PmsProvider, available: z.boolean(), connection: ConnectionDto.nullable() })),
});
export const SyncLogEntry = z.object({ id: z.string().uuid(), level: z.enum(['info','warning','error']), code: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])), at: z.string().datetime() });
export const SyncLogResponse = z.object({ entries: z.array(SyncLogEntry) });
```

Routes (helper `route()` adding `{ auth: true, workspaceScoped: true }`, as in `commerce.routes.ts:27-30`,
tag `integration`): `GET /integrations` → 200 `IntegrationListResponse`; `POST /integrations/kiotviet/test`
→ 200 `KiotVietTestResponse`, 400; `POST /integrations/kiotviet` → 201 `ConnectionDto`, 400, 409;
`PATCH /integrations/kiotviet` → 200 `ConnectionDto`, 400, 404, 409; `POST /integrations/kiotviet/sync` → 202
null, 404, 409; `GET /integrations/kiotviet/log` → 200 `SyncLogResponse`, 404; `DELETE /integrations/kiotviet`
→ 204 null, 404.

Commerce: `ProductDto` gains `external: z.object({ source: z.literal('kiotviet'), id: z.string() }).nullable()`;
`ProductListQuery` gains `source: z.enum(['kiotviet','rapiz']).optional()`.

- [ ] **Step 1:** Failing schema tests: settings refine rejects an order branch outside sale branches; credentials trim; `ConnectionDto` has no secret field (`expect(Object.keys(ConnectionDto.shape)).not.toContain('clientSecret')`).
- [ ] **Step 2:** Run `pnpm --filter @agent-sales/contracts test -- integration` → FAIL.
- [ ] **Step 3:** Implement schemas, routes, exports; extend commerce schemas.
- [ ] **Step 4:** Contracts tests PASS; `pnpm --filter @agent-sales/contracts typecheck`. Backend `http.spec.ts` will fail until Task 7 serves the routes — that is expected; do not merge without Task 7.
- [ ] **Step 5: Commit** `feat(contracts): PMS integration routes and product external link`

### Task 3: Commerce — external links, locked fields and the catalog sync facade

**Files:**
- Create: `apps/backend/src/modules/commerce/domain/external-lock.ts` (+ `.spec.ts`), `api/catalog-sync.facade.ts`, `application/catalog-sync.service.ts`, `__tests__/catalog-sync.integration.spec.ts`
- Modify: `application/ports/commerce-store.ts` (`ProductRecord.external`, `VariantRecord.externalId`, new tx methods), `infrastructure/persistence/catalog.drizzle.ts`, `commerce.rows.ts`, `application/catalog.service.ts` (`updateProduct` 377-430, `adjustStock` 432, product delete/archive path), product mapper to `ProductDto.external`, list filter `source`, `api/index.ts`, `commerce.module.ts` (provide + export `CATALOG_SYNC_FACADE`), `domain/commerce.errors.ts` (`ExternalSourceLockedError`), `MODULE.md`.

**Interfaces — Produces:**

```ts
// api/catalog-sync.facade.ts
export type ExternalSource = 'kiotviet';
export interface ExternalVariantInput { externalId: string; sku: string; name: string; price: number; weightGram: number; position: number }
export interface ExternalCatalogItem {
  externalId: string; name: string; description: string; category: string | null;
  active: boolean; imageUrls: string[];          // already Rapiz-stored URLs (importExternalImage)
  variants: ExternalVariantInput[];              // ≥ 1
}
export interface CatalogSyncFacade {
  /** Codes of the store vs the catalog: how many match an existing SKU, are new, or stay Rapiz-only. */
  previewExternalMatch(ws: WorkspaceId, codes: string[]): Promise<{ matched: number; created: number; rapizOnly: number }>;
  upsertExternalProduct(ws: WorkspaceId, source: ExternalSource, item: ExternalCatalogItem): Promise<{ productId: string; created: boolean }>;
  removeExternalProducts(ws: WorkspaceId, source: ExternalSource, externalIds: string[]): Promise<number>;
  setExternalStock(ws: WorkspaceId, source: ExternalSource, rows: Array<{ externalVariantId: string; available: number }>): Promise<number>;
  importExternalImage(ws: WorkspaceId, url: string): Promise<string>;   // throws ImageDownloadError-derived ExternalImageError
  releaseExternalSource(ws: WorkspaceId, source: ExternalSource): Promise<number>;
  countExternalProducts(ws: WorkspaceId, source: ExternalSource): Promise<number>;
}
export const CATALOG_SYNC_FACADE = Symbol('CATALOG_SYNC_FACADE');
```

```ts
// domain/external-lock.ts — pure
export const LOCKED_PRODUCT_FIELDS = ['name','description','category','imageUrls','status','variants'] as const;
export type LockedField = (typeof LOCKED_PRODUCT_FIELDS)[number] | 'stock';
/** The first linked field an update changes, or null. Variants compare (sku, name, price, cost, weightGram) by id and the id set. */
export function lockedChange(current: LockableProduct, next: LockableProduct): LockedField | null;
```

Rules (spec §5.1, §5.4):
- `upsertExternalProduct`: inside one `store.run(ws)`: find product by `(source, externalId)`; if none,
  find variants whose SKU (case-insensitive) equals any input `sku` and adopt their product when all of
  them belong to one Rapiz product without a link; else create (code = first variant SKU; on code clash
  append `-KV<externalId>`). Update only linked fields; never touch `visibleToBot`, `botInstructions`, bot
  selection, or `accommodation`. Variants matched by `externalId`, then by SKU; missing ones of this product
  archived; SKU clash with another product's variant → that input variant is skipped and the call returns it
  in `skipped: string[]` (add to the return type) so the integration logs `sku_conflict`.
  New variants get an inventory row at the default warehouse with `on_hand 0`.
- `setExternalStock`: for each linked variant at the default warehouse, `delta = available − on_hand`;
  when non-zero, apply through the existing inventory apply path with reason `adjust`,
  `refType: 'external'` (extend the `StockChange.refType` union), actor null.
- `importExternalImage`: reuse `downloadImage` (`infrastructure/image-import/download-image.ts:107`) and
  `PRODUCT_IMAGE_STORAGE.put` with key `products/<ws>/<newId()>.<jpg|png>`; WebP/other → `ExternalImageError('unsupported_format')`.
- Locks: `updateProduct` loads `current`; when `current.external` is set, `lockedChange(current, input)` → throw
  `ExternalSourceLockedError(field)` mapped to 409 `CONFLICT` with `details = { reason: 'EXTERNAL_SOURCE', field }`.
  `adjustStock` on a linked variant → same error with `field: 'stock'`. Archiving/deleting a linked
  product → same error with `field: 'status'`.
- `releaseExternalSource`: set `external_source/external_id` to null on products and variants of that source.

- [ ] **Step 1:** Unit tests for `lockedChange` (unchanged bot fields → null; price change → 'variants'; picture order change → 'imageUrls').
- [ ] **Step 2:** Integration tests (real DB, pattern `__tests__/bot-orders.integration.spec.ts`): create via upsert → second upsert updates price and archives a removed variant → bot fields survive → adopt-by-SKU of a pre-existing product → `setExternalStock` writes one movement and is idempotent → `updateProduct` with a new name on a linked product is 409 `EXTERNAL_SOURCE` while toggling `visibleToBot` passes → `releaseExternalSource` makes it editable.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run `pnpm --filter @agent-sales/backend test -- commerce` → PASS (all existing commerce tests too).
- [ ] **Step 6: Commit** `feat(commerce): catalog sync facade and read-only fields for PMS-linked products`

### Task 4: Integration module scaffold and pure domain

**Files:**
- Run: `pnpm gen module integration`
- Create in `apps/backend/src/modules/integration/domain/`: `kiotviet-mapping.ts`, `stock.ts`, `signature.ts`, `retailer.ts`, `integration.errors.ts` (generator file) + a `.spec.ts` beside each.
- Modify: `apps/backend/src/app.module.ts` (import `IntegrationModule`), `docs/ARCHITECTURE.md` §3 tier-3 row (`integration` on `commerce`, `crm`, `workspace` facades — ADR-017).

**Interfaces — Produces:**

```ts
// kiotviet-mapping.ts (domain may not import contracts' zod; define plain types here)
export interface KvProduct {
  id: number; code: string; name: string; fullName?: string; categoryName?: string | null;
  allowsSale?: boolean; hasVariants?: boolean; masterProductId?: number | null; masterUnitId?: number | null;
  unit?: string | null; conversionValue?: number | null;
  attributes?: Array<{ attributeName: string; attributeValue: string }>;
  basePrice?: number; weight?: number | null; images?: string[]; description?: string | null;
  inventories?: Array<{ branchId: number; onHand: number; reserved: number }>;
}
export interface MappedItem { externalId: string; name: string; description: string; category: string | null;
  active: boolean; sourceImageUrls: string[]; variants: Array<{ externalId: string; sku: string; name: string; price: number; weightGram: number; position: number }> }
/** Groups a page set of KiotViet products into catalog items keyed by master id. */
export function groupKvProducts(products: KvProduct[]): MappedItem[];
/** Master id of a KiotViet product (itself when it is a master). */
export function masterOf(p: KvProduct): number;
export function stripHtml(html: string): string;
```

Mapping rules (spec §5.1): master = `masterProductId == null && masterUnitId == null`; children join by
`masterProductId ?? masterUnitId`; master is variant position 0; variant name = attribute values joined by
`' / '`, plus `unit` when the group has more than one distinct unit, else `'Mặc định'` when empty (check the
default variant name the product form uses — grep `defaultVariant` / variant name in `catalog.service.ts`);
price = `Math.round(basePrice ?? 0)`; weightGram = `Math.round(weight ?? 0)`; active = master `allowsSale !== false`;
images = first 5 of master `images`; children whose master is not in the set are grouped under their master id
anyway (the caller fetches the master by id — see Task 8).

```ts
// stock.ts
export function availableBySaleBranches(inv: Array<{ branchId: number; onHand: number; reserved: number }>, saleBranchIds: readonly number[]): number; // Σ max(0, onHand − reserved) over sale branches, integer
// signature.ts
export function validKiotVietSignature(rawBody: string, header: string | undefined, secret: string): boolean; // hex HMAC-SHA256; accept optional "sha256=" prefix; timingSafeEqual; false on length mismatch
// retailer.ts
export function parseRetailer(input: string): string | null; // "https://abc.kiotviet.vn/man" | "abc.kiotviet.vn" | "abc" → "abc"; [a-z0-9-]{2,64} else null; lowercased
```

`integration.errors.ts`: `KiotVietAuthError` (bad client id/secret), `KiotVietRetailerError`,
`KiotVietPermissionError(missing: string[])`, `KiotVietUnavailableError`, `ConnectionExistsError`,
`ConnectionNotFoundError`, `SyncAlreadyRunningError` — all `DomainError` with codes the controller maps
(400 `VALIDATION_FAILED` + `details.reason` for the first three, 503 `UNAVAILABLE`, 409, 404, 409).

- [ ] Steps: failing specs (masters/variants/units/orphans/no images/HTML; stock with negative and missing branches; signature good/bad/prefixed/empty; retailer forms) → FAIL → implement → PASS → `pnpm arch` clean → commit `feat(integration): module scaffold and KiotViet domain mapping`.

### Task 5: KiotViet client

**Files:**
- Create: `application/ports/kiotviet-gateway.ts`, `infrastructure/clients/kiotviet-client.ts`, `infrastructure/clients/kiotviet.schemas.ts`, `__tests__/kiotviet-client.spec.ts`, `__tests__/fake-kiotviet.ts` (in-process Fastify fake reused by later tests)

**Interfaces — Produces:**

```ts
export interface KvCredentials { retailer: string; clientId: string; clientSecret: string }
export interface KvPage<T> { data: T[]; total: number; removedIds: number[] }
export interface KiotVietGateway {
  branches(c: KvCredentials): Promise<Array<{ id: number; name: string; address: string | null }>>;
  products(c: KvCredentials, q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date }): Promise<KvPage<KvProduct>>;
  productById(c: KvCredentials, id: number): Promise<KvProduct | null>;
  onHands(c: KvCredentials, q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date; branchIds: number[] }): Promise<KvPage<{ productId: number; inventories: Array<{ branchId: number; onHand: number; reserved: number }> }>>;
  productCodes(c: KvCredentials): AsyncIterable<string>;     // for the preview
  registerWebhook(c: KvCredentials, w: { type: string; url: string; secretBase64: string }): Promise<number>;
  deleteWebhook(c: KvCredentials, id: number): Promise<void>;
  listWebhooks(c: KvCredentials): Promise<Array<{ id: number; type: string; url: string }>>;
}
export const KIOTVIET_GATEWAY = Symbol('KIOTVIET_GATEWAY');
```

Behaviour: token per `clientId` cached until `expires_in − 300 s`; one in-flight token request per client;
a 401 on an API call clears the token and retries once, then a second 401 → `KiotVietRetailerError` if the token
call succeeded with a fresh token, the token call itself 400/401 → `KiotVietAuthError`; 403 →
`KiotVietPermissionError`; 429/5xx/timeout (15 s, `AbortSignal.timeout`) → up to 3 retries with 1 s/4 s/15 s
backoff (injectable `sleep`), then `KiotVietUnavailableError`. Budget: in-memory token bucket per retailer,
capacity 10, refill 4 500/3 600 per second; waits (injectable clock). Base URLs from env
`KIOTVIET_TOKEN_URL` (default `https://id.kiotviet.vn/connect/token`) and `KIOTVIET_API_URL` (default
`https://public.kiotapi.com`) — add both to `common/config.ts` (optional with defaults), `.env.example`, and
`docs/10-operations-and-deployment.md`. Payloads parsed with tolerant schemas (`.passthrough()`, numbers via
`z.coerce`), `removeId`/`removedIds` both accepted. Never log the secret, token or response bodies.

- [ ] Steps: fake server serving token/branches/products(2 pages)/onhands/webhooks with switches for 401/403/429 → tests (token reuse and refresh, pagination, 429 retry then success, 401 auth vs retailer mapping, 403) → FAIL → implement → PASS → commit `feat(integration): KiotViet API client with token cache, budget and retries`.

### Task 6: Integration persistence

**Files:**
- Create: `application/ports/integration-store.ts`, `infrastructure/persistence/integration.drizzle-store.ts`, `infrastructure/persistence/unavailable-store.ts`, `__tests__/integration-store.integration.spec.ts`

**Interfaces — Produces:**

```ts
export interface ConnectionRecord { id: string; workspaceId: WorkspaceId; provider: 'kiotviet'; status: 'connected'|'syncing'|'error'|'disconnected';
  retailer: string; clientId: string; clientSecretSealed: string; webhookToken: string; webhookSecretSealed: string;
  settings: { saleBranchIds: number[]; orderBranchId: number; pushOrders: boolean; syncCustomers: boolean; webhookIds?: number[]; branches?: Array<{ id: number; name: string; address: string | null }> };
  version: number; progress: { phase: string; done: number; total: number | null } | null;
  counts: { products?: number; customers?: number; ordersPushed?: number }; lastError: { code: string; at: string } | null;
  lastFullSyncAt: Date | null; lastReconcileAt: Date | null; connectedByUserId: string | null; createdAt: Date; updatedAt: Date }
export interface JobRecord { id: string; workspaceId: WorkspaceId; connectionId: string; kind: 'full_import'|'reconcile'|'webhook'; payload: Record<string, unknown>; cursor: Record<string, unknown> | null; attempts: number; claimToken: string }
export interface IntegrationStore {
  // tenant-scoped (withTenant)
  liveConnection(ws: WorkspaceId, provider: 'kiotviet'): Promise<ConnectionRecord | null>;
  insertConnection(ws: WorkspaceId, c: ConnectionRecord): Promise<void>;       // ConnectionExistsError on the partial unique index
  updateConnection(ws: WorkspaceId, id: string, patch: Partial<ConnectionRecord>, expectedVersion?: number): Promise<ConnectionRecord>; // stale → ConflictError
  enqueue(ws: WorkspaceId, job: { connectionId: string; kind: JobRecord['kind']; payload?: Record<string, unknown>; runAfter?: Date }): Promise<boolean>; // false when a sync is already open (unique index)
  log(ws: WorkspaceId, connectionId: string, e: { level: 'info'|'warning'|'error'; code: string; params?: Record<string, string|number> }): Promise<void>; // keeps the newest 200
  recentLog(ws: WorkspaceId, connectionId: string, limit: number): Promise<Array<{ id: string; level: string; code: string; params: Record<string, string|number>; at: Date }>>;
  cachedImage(ws: WorkspaceId, sourceUrl: string): Promise<string | null>;
  cacheImage(ws: WorkspaceId, sourceUrl: string, storedUrl: string): Promise<void>;
  // system role (DB_SYSTEM): claim across tenants
  claimJobs(limit: number, leaseMs: number): Promise<JobRecord[]>;             // FOR UPDATE SKIP LOCKED, run_after <= now, lease expired or null; sets lease + claim_token, attempts+1
  saveCursor(jobId: string, claimToken: string, cursor: Record<string, unknown>): Promise<void>;
  completeJob(jobId: string, claimToken: string): Promise<void>;
  retryJob(jobId: string, claimToken: string, runAfter: Date, error: string): Promise<void>;
  failJob(jobId: string, claimToken: string, error: string): Promise<void>;
  claimWebhookEvents(limit: number): Promise<Array<{ id: string; workspaceId: WorkspaceId; connectionId: string; body: string; signature: string | null }>>; // marks processed_at in the same statement (at-most-once is fine: reconcile covers losses)
  connectionsDueForReconcile(olderThan: Date): Promise<Array<{ workspaceId: WorkspaceId; connectionId: string }>>; // status connected|error, not disconnected
  connectionForSystem(id: string): Promise<ConnectionRecord | null>;
}
export const INTEGRATION_STORE = Symbol('INTEGRATION_STORE');
```

Follow `channel/infrastructure/persistence/channel.store.ts:137-221` for the lease SQL and the
`DB_TENANT`/`DB_SYSTEM` optional injection with an unavailable fallback (see `commerce.module.ts:59-64`).

- [ ] Steps: integration tests (insert/duplicate live connection; version conflict; enqueue dedupes open syncs; claim → lease → retry → fail; two concurrent claims never return the same job; webhook claim marks processed; log keeps 200) → FAIL → implement → PASS → commit `feat(integration): connection, job and webhook persistence`.

### Task 7: Connection service and HTTP API

**Files:**
- Create: `application/connection.service.ts`, `interface/http/integration.controller.ts`, `__tests__/connection.service.spec.ts` (fake gateway + in-memory store), extend `__tests__/integration.http.spec.ts` or the global `apps/backend/test/http.spec.ts` stays green.
- Modify: `integration.module.ts` (imports `CommerceModule`, `WorkspaceModule`; provides `SECRET_BOX` like `channel.module.ts:39-45`, `KIOTVIET_GATEWAY`, `INTEGRATION_STORE`, services, controller), `common/config.ts` (+ `PUBLIC_WEBHOOK_BASE_URL` if no existing var gives the public webhook origin — grep `META_APP_ORIGIN`/`PUBLIC_` first and reuse).

**Behaviour (spec §4.5, §6.3, §8):**
- `test(ws, creds)`: `parseRetailer` (null → `KiotVietRetailerError`), `gateway.branches`, then
  `catalogSync.previewExternalMatch(ws, codes)` from `gateway.productCodes` (stop after 3 000 codes; the response also carries `scanned` and the store `total`) →
  `KiotVietTestResponse`. Stores nothing.
- `connect(ws, user, req)`: refuse when a live connection exists (409); re-run the branch fetch (validates
  creds and branch ids); generate `webhookToken = randomBytes(32).toString('base64url')`, webhook secret
  `randomBytes(24)`; seal both secrets; insert with `status: 'syncing'`; register webhooks for
  `product.update, product.delete, stock.update` at `${PUBLIC_WEBHOOK_BASE}/webhooks/kiotviet/${token}` with
  the base64 secret (store ids in `settings.webhookIds`; a registration failure is logged as `webhook_register_failed`
  and the reconcile still keeps data fresh); enqueue `full_import`; log `connected`.
- `update(ws, req)`: version check; credentials → re-test then re-seal and clear `lastError`, status back to
  `connected`; settings branch change → enqueue `reconcile` with `payload.full = true`.
- `syncNow(ws)`: enqueue `reconcile`; `false` → `SyncAlreadyRunningError` (409).
- `disconnect(ws)`: delete registered webhooks (best effort), `catalogSync.releaseExternalSource`, status
  `disconnected`, `disconnected_at = now`; log nothing further.
- `list(ws)`: KiotViet entry with `toDto(connection)` (mask client id `••••` + last 4) and three
  `available: false` providers.
- Controller: `@WorkspaceScoped()`; GET routes `@RequireCapability('catalog.manage')`, writes
  `@RequireCapability('settings.manage')`; map domain errors (Task 4 list).

- [ ] Steps: service specs (test happy path + each error; connect seals secrets and never returns them; duplicate connect 409; update stale 409; disconnect releases) → FAIL → implement → PASS; `pnpm --filter @agent-sales/backend test -- http` PASS (routes declared = served) → commit `feat(integration): connect, test, update and disconnect KiotViet`.

### Task 8: Sync service, runner and worker wiring

**Files:**
- Create: `application/sync.service.ts`, `application/sync-runner.ts`, `api/integration.runner.ts` (export `INTEGRATION_RUNNER` + interface `{ tick(): Promise<void> }` so the worker entry imports only `api/`), `__tests__/sync.service.spec.ts`, `__tests__/sync.integration.spec.ts`
- Modify: `apps/backend/src/entries/worker.ts` (import `IntegrationModule`, second guarded `setInterval` 2 s calling the runner like the analytics one)

**Behaviour:**
- `runJob(job)`: load connection via system lookup, then everything inside the job's workspace.
  - `full_import` (and `reconcile` with `payload.full`): cursor `{ phase, currentItem }`; phases
    `products` (pageSize 100, `includeInventory` off) → for each page `groupKvProducts`; for groups whose master
    is missing from the page, `gateway.productById(master)`; for each item import pictures (cache first; on
    failure count `image_failed`), `upsertExternalProduct`, collect `skipped` → log `sku_conflict` with the SKU;
    `saveCursor` after each page; update `progress`. Then `stock`: `onHands` pages with the sale branch ids →
    `setExternalStock` with `availableBySaleBranches`. Finally `removeExternalProducts` for ids that were linked
    but not seen (full only), `counts.products = countExternalProducts`, `last_full_sync_at`, status `connected`,
    progress null, log `full_sync_done {products, images_failed}`.
  - `reconcile`: same calls with `lastModifiedFrom = lastReconcileAt − 2 min` (or full when null),
    `removedIds` → `removeExternalProducts`; set `last_reconcile_at`.
  - `webhook` events (from `claimWebhookEvents`): open `webhookSecretSealed`; bad signature → log
    `webhook_bad_signature` and drop; parse `{ Id, Attempt, Notifications: [{ Action, Data }] }` tolerantly;
    `product.update` → refetch each product id via `productById` (do not trust partial `Data`) and upsert its
    group; `product.delete` → `removeExternalProducts(RemoveId)`; `stock.update` → refetch on-hands for those
    product ids (`onHands` with `lastModifiedFrom` = now − 5 min filtered, or `productById` with inventories);
    unknown actions → log `webhook_unknown` once per type.
  - Errors: `KiotVietAuthError`/`RetailerError` → status `error`, `lastError`, `failJob`, log
    `auth_failed` (the page shows "Cập nhật mã"); `KiotVietUnavailableError` → `retryJob` (+1, +5, +30 min, then
    fail and log `kiotviet_unavailable`); anything else → retry, then fail with log `sync_failed`.
- `SyncRunner.tick()`: (1) every 60 s enqueue `reconcile` for `connectionsDueForReconcile(now − 10 min)`;
  (2) claim ≤ 5 jobs (lease 5 min) and run them sequentially; (3) claim ≤ 50 webhook events and apply them.
  Skips when the DB is unavailable.

- [ ] Steps: unit tests with the fake gateway and in-memory catalog facade (resume from cursor after a thrown
  page; webhook bad signature dropped; auth error → status error) → integration test with real DB + fake
  KiotViet server: full import of 150 products in 2 pages → linked products, variants, stock at the default
  warehouse → `stock.update` webhook changes stock → reconcile picks a renamed product → FAIL → implement →
  PASS → start the worker locally (`pnpm --filter @agent-sales/backend dev:worker` or the script the
  `.dev-logs` setup uses) and see the tick log line → commit `feat(integration): KiotViet full import, webhooks and reconcile on the worker`.

### Task 9: Webhook ingress route

**Files:**
- Create: `apps/webhook/src/kiotviet.ts` (route registration + store port), `apps/webhook/src/infrastructure/kiotviet-ingress.store.ts`, `apps/webhook/src/kiotviet.test.ts`
- Modify: `apps/webhook/src/server.ts` (register the route; keep the raw body parser), `apps/webhook/src/main.ts` (wire the store with `withSystem`)

Behaviour: `POST /webhooks/kiotviet/:token` — token must match `^[A-Za-z0-9_-]{43}$` else 410; body ≤ 1 MiB
(413); look up a live connection by `webhook_token` (not found or disconnected → 410); parse only `Id` from
the JSON (missing → use sha256 of the body); insert `integration_webhook_events` (`on conflict do nothing`)
with the `x-hub-signature` header; answer 200 `{ ok: true }` within the 5 s limit (no outbound calls).

- [ ] Steps: tests with an in-memory store (200 + stored once on duplicate `Id`; unknown token 410; oversize
  413; no signature still stored — the worker drops it) → FAIL → implement → PASS → through the tunnel,
  `curl -X POST https://<tunnel>/webhooks/kiotviet/<token>` reaches the app (dev proxy already routes
  `/webhooks/*`) → commit `feat(webhook): receive KiotViet webhooks per connection`.

### Task 10: Web — "Tích hợp PMS" hub, wizard and connection view

**Files:**
- Run: `pnpm gen feature integration`
- Create: `apps/web/src/features/integration/api/integrations.ts` (hooks: `useIntegrations`, `useTestKiotViet`, `useConnectKiotViet`, `useUpdateKiotViet`, `useSyncKiotViet`, `useKiotVietLog`, `useDisconnectKiotViet`; query key `['integrations', ws]`; poll every 3 s while `status === 'syncing'`), `components/integrations-hub.tsx`, `provider-card.tsx`, `kiotviet-page.tsx` (switches wizard ↔ connection view), `kiotviet-wizard.tsx`, `wizard-credentials-step.tsx`, `wizard-branches-step.tsx`, `wizard-review-step.tsx`, `kiotviet-connection-view.tsx`, `sync-log-list.tsx`, `kiotviet-logo.tsx` (simple SVG wordmark — official asset not bundled; text "KiotViet" in a rounded tile), tests `*.test.tsx` beside each.
- Create: `apps/web/src/routes/app/integrations/index.tsx`, `apps/web/src/routes/app/integrations/kiotviet.tsx`
- Create: `packages/i18n/src/messages/{vi,en}/integration.json`; Modify `packages/i18n/src/{vi,en}.ts` to register namespace `integration`.
- Modify: `apps/web/src/components/layout/app-sidebar.tsx` (item `{ to: '/app/integrations', key: 'nav.pms', icon: Blocks, ready: true }` after `PRODUCTS`; for `industry === 'hotel'` after `INTEGRATIONS`; shown when `useCan('catalog.manage')`), `common.json` vi `"pms": "Tích hợp PMS"`, en `"pms": "PMS integrations"`.

UI rules (spec §6): one primary button per step; labels visible; helper text below fields; errors under the
field (`details.reason`: `kiotviet_auth` → Client ID + Mã bảo mật, `kiotviet_retailer` → Tên gian hàng,
`kiotviet_permission` → banner listing `missing`); focus the first invalid field; step indicator "Bước 1/3";
Back keeps entered values; the secret field has a show/hide toggle and `autocomplete="off"`; status badge uses
icon + text; stat numbers `tabular-nums`; destructive "Ngắt kết nối" in a separated danger card with an
`AlertDialog`; skeletons while loading; toasts on save. Colours only via tokens. Users without
`settings.manage` see the connection view read-only (no wizard, no buttons).

Vietnamese copy (vi `integration.json`, keys mirrored in en):
- hub: title "Tích hợp PMS", subtitle "Kết nối phần mềm quản lý bán hàng để bot tư vấn đúng giá, đúng tồn kho và đơn chốt tự vào phần mềm của bạn.", `comingSoon` "Sắp có", `connect` "Kết nối", `manage` "Quản lý".
- providers: kiotviet "Đồng bộ sản phẩm, tồn kho theo chi nhánh, đơn hàng và khách hàng.", sapo/haravan/pancake_pos names.
- wizard: `steps` ["Thông tin kết nối", "Chi nhánh", "Xem trước & bắt đầu"], `retailer` "Tên gian hàng", `retailerHelp` "Phần trước .kiotviet.vn, ví dụ: shopabc. Dán cả đường link cũng được.", `clientId` "Client ID", `clientSecret` "Mã bảo mật", `where` "Lấy mã ở đâu?", `whereSteps` ["Đăng nhập KiotViet bằng tài khoản chủ cửa hàng.", "Vào Thiết lập → Cửa hàng → Kết nối API, bấm Chỉnh sửa.", "Xác thực bằng số điện thoại, bấm Tạo mã và tick quyền truy cập khách hàng, hoá đơn, đặt hàng.", "Sao chép Client ID và Mã bảo mật dán vào đây."], `guideLink` "Xem hướng dẫn của KiotViet", `test` "Kiểm tra kết nối", `errors.auth` "Client ID hoặc mã bảo mật không đúng. Kiểm tra lại trong KiotViet → Thiết lập kết nối API.", `errors.retailer` "Không tìm thấy gian hàng này. Tên gian hàng là phần trước .kiotviet.vn.", `errors.permission` "Tài khoản API chưa được cấp quyền: {{list}}. Tick các quyền này trong KiotViet rồi thử lại.", `errors.unavailable` "KiotViet đang không phản hồi. Thử lại sau ít phút.", `branchesTitle` "Chi nhánh dùng để bán online", `branchesHelp` "Bot báo tồn kho bằng tổng hàng còn lại của các chi nhánh bạn chọn.", `orderBranch` "Chi nhánh nhận đơn", `preview` "{{matched}} sản phẩm khớp theo mã · {{created}} sản phẩm mới · {{rapizOnly}} sản phẩm chỉ có trên Rapiz (giữ nguyên)", `pushOrders` "Đẩy đơn sang KiotViet", `syncCustomers` "Đồng bộ khách hàng", `soon` "Sắp có", `sourceNote` "Sau khi kết nối, tên, giá, ảnh và tồn kho của sản phẩm liên kết được sửa trên KiotViet. Cài đặt riêng cho bot vẫn sửa trên Rapiz.", `start` "Bắt đầu đồng bộ", `back` "Quay lại", `next` "Tiếp tục".
- connection: `status.connected` "Đã kết nối", `status.syncing` "Đang đồng bộ", `status.error` "Lỗi", `lastSync` "Đồng bộ lần cuối {{time}}", `syncNow` "Đồng bộ ngay", `progress.products` "Đang nhập sản phẩm {{done}}/{{total}}", `progress.stock` "Đang cập nhật tồn kho", `stats.products` "Sản phẩm liên kết", `stats.customers` "Khách hàng", `stats.orders` "Đơn đã đẩy", `settings` "Cài đặt đồng bộ", `save` "Lưu", `updateCredentials` "Cập nhật mã", `activity` "Hoạt động gần đây", `danger` "Ngắt kết nối", `dangerHelp` "Dữ liệu đã đồng bộ được giữ lại. Sản phẩm sẽ thành sản phẩm của Rapiz và sửa được như bình thường.", `confirmDisconnect` "Ngắt kết nối KiotViet?".
- log codes: `connected` "Đã kết nối gian hàng {{retailer}}", `full_sync_done` "Đã đồng bộ {{products}} sản phẩm", `image_failed` "{{count}} ảnh không tải được (chỉ nhận JPEG/PNG)", `sku_conflict` "Mã {{sku}} trùng với một sản phẩm khác trên Rapiz — đổi mã ở một bên để liên kết", `auth_failed` "KiotViet từ chối mã bảo mật — có thể mã đã bị đổi. Bấm Cập nhật mã.", `kiotviet_unavailable` "KiotViet không phản hồi, sẽ thử lại", `webhook_register_failed` "Không đăng ký được cập nhật tức thời — vẫn đồng bộ mỗi 10 phút", `webhook_bad_signature` "Bỏ qua một thông báo không hợp lệ", `sync_failed` "Đồng bộ thất bại, sẽ thử lại".

- [ ] Steps: component tests (credentials step shows field errors per `reason` and focuses the field; branches
  step requires ≥ 1 and order branch among them; review step renders the preview sentence; connection view
  shows progress while syncing and hides buttons without `settings.manage`; sidebar shows "Tích hợp PMS" after
  "Sản phẩm") → FAIL → implement → PASS (`pnpm --filter @agent-sales/web test -- integration`) → commit
  `feat(web): Tích hợp PMS page with the KiotViet connect wizard`.

### Task 11: Web — products list and form for linked products

**Files:**
- Modify: `apps/web/src/features/commerce/components/products-list.tsx` (KiotViet badge on rows with `external`; "Nguồn" filter → `source` query param; slim sync bar and the dismissible hint card), `product-form.tsx` (+ `product-images-editor.tsx`): locked fields read-only with lock icon and hint "Sửa trên KiotViet" linking to `https://<retailer>.kiotviet.vn` — the retailer comes from the route, which reads `useIntegrations` (features may not import each other: compose in `routes/app/products/*.tsx` and pass `pmsLink: { retailer, lastSyncAt } | null` and `onDismissHint` as props); bot section stays editable; the stock adjust control hidden for linked variants.
- Modify: `apps/web/src/features/commerce/api/commerce.ts` (list param `source`), `common.json` vi/en (`products.source`, `products.sourceKiotviet`, `products.sourceRapiz`, `products.lockedHint` "Sửa trên KiotViet", `products.pmsBar` "Đồng bộ với KiotViet · {{time}}", `products.pmsHint` "Đang dùng KiotViet? Nhập sản phẩm tự động", `products.pmsHintAction` "Kết nối KiotViet").
- Test: `products-list.test.tsx`, `product-form.test.tsx` (new or extended).

Hint card: shown when not connected, the business is not `hotel`, and not dismissed (localStorage key
`rapiz.pmsHint.dismissed.<ws>`, wrapped in try/catch).

- [ ] Steps: tests (badge renders; filter sets `source`; locked inputs are `readOnly` with the hint; bot toggle still editable; hint dismiss persists) → FAIL → implement → PASS → commit `feat(web): show and lock KiotViet-linked products`.

### Task 12: E2E, docs and the full gate

**Files:**
- Create: `apps/web/e2e/pms-kiotviet.spec.ts` (after `mockApi(page)`, route `**/api/v1/integrations**`: test → branches + preview; connect → syncing then connected on the next GET; widths 375, 768, 1280; assert no horizontal overflow like `responsive.spec.ts`), add `/integrations` default (`{ providers: [...] }` not connected) to `e2e/support/mock-api.ts` so other specs still pass.
- Create: `docs/integrations/kiotviet.md` — what it does, owner setup steps (same 4 steps as the wizard), data flow (full import, webhooks, 10-minute reconcile), what is locked, limits (5 000 req/h, JPEG/PNG pictures, 5 pictures), troubleshooting per log code, env vars.
- Modify: `apps/backend/src/modules/integration/MODULE.md` (purpose, owned tables, public API, runner, invariants, do-not, test commands), `apps/backend/src/modules/commerce/MODULE.md` (catalog sync facade, locks, link columns), `docs/ARCHITECTURE.md` §3 (done in Task 4 — verify), `docs/03-screens-and-routes.md` (sidebar item + routes), `docs/05-data-model.md` (tables/columns), `docs/07-channel-integrations.md` (KiotViet row: shipped products/stock, orders and customers next; link to `docs/integrations/kiotviet.md`), `docs/02-functional-requirements.md` (ORD-15 priority/status), `docs/10-operations-and-deployment.md` (env vars, worker now runs the integration tick), `.env.example`.

- [ ] **Step 1:** Write the e2e spec → run `pnpm --filter @agent-sales/web e2e -- pms-kiotviet responsive statistics-home` → PASS.
- [ ] **Step 2:** Docs.
- [ ] **Step 3:** `pnpm check` → all tasks successful. Fix anything red with new commits (never skip tests).
- [ ] **Step 4:** Manual run on the dev stack in the worktree (ports must not clash with the main checkout's dev servers — use `PORT`/`WEB_PORT` overrides, or run only backend tests here and verify UI via Playwright mocks) and, if the owner provides a KiotViet trial store, a real connect → import → edit price in KiotViet → see it in Rapiz within seconds.
- [ ] **Step 5: Commit** `docs: KiotViet integration guide and module docs`; then follow `open-pr` (update with `origin/main`, `pnpm check`, push, PR with verification section).
