# Website Chat Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop pastes one `<script>` on its website and gets a chat bubble that is a full Rapiz channel: the bot answers, staff take over from the shared inbox, and a visitor's phone number becomes a CRM customer.

**Architecture:** Website = a `channel_connections` row (`provider: 'website'`). A new public `webchat` backend module receives widget traffic, writes customer messages into the existing durable queue `channel_webhook_events`, and the existing inbox processor answers them; website "delivery" is local (mark sent) and the widget polls for new messages. The widget (`apps/widget`) is a plain-TypeScript Shadow DOM bundle built to ES2017.

**Tech Stack:** NestJS 12 on Fastify, Drizzle + Postgres 16 (RLS via `tenantPolicies`), Zod contracts in `packages/contracts`, Vitest (+ Testcontainers for `*.integration.spec.ts`), Vite + React (dashboard), esbuild (widget bundle), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md` — read it before your task.

**Worktree:** `/home/kenknight/Workspace/agent-sale-webchat`, branch `feat/T-097-website-chat-channel` (based on `main`). Work ONLY in this folder. Another agent works in `/home/kenknight/Workspace/agent-sale` — never touch it.

## Global Constraints

- Repo rules are binding: read `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md` before coding. English for code, comments, commits, docs. Vietnamese only in UI strings (i18n) and widget copy.
- Modules talk only through `api/` facades; never read another module's tables. New backend module only via `pnpm gen module <name>`.
- Every tenant table uses `tenantPolicies(...)`; cross-tenant lookups use `withSystem(...)` with the `DB_SYSTEM` connection, as `channel.store.ts` does.
- Migrations are additive and backward-compatible (nullable columns, new tables). Next migration file number: check `packages/db/migrations/` and take the highest number + 1 (currently `0025`).
- No PII in logs: never log phone numbers (use `maskPhone`), visitor tokens, message text or IPs.
- Do not change existing Meta behaviour. Existing tests must pass **unchanged** — never edit, skip or delete an existing test to get green.
- Deviations from the spec agreed by the coordinator: (1) **do not rename** `MetaInboxProcessor`, `PendingMetaEvent` or their files (another branch edits them); add capability-driven branches instead. (2) Rate limiting is an **in-memory** limiter behind a `RateLimiter` port (no Redis client exists in the backend yet). Note both in docs.
- Commit after each task with Conventional Commits, message ends with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Verification per task: `pnpm --filter @agent-sales/backend typecheck`, `pnpm --filter @agent-sales/backend test`, plus the package-specific commands named in the task; integration specs with `pnpm --filter @agent-sales/backend test:integration -- <file>` (needs Docker, available). Run `pnpm check` at the end of Tasks 2, 4, 6 and 8.
- Task ids: T-097 … T-104 (T-095 and T-096 are taken by other branches).

## File map

| Area | Files |
|---|---|
| Docs/ADR | `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/adr/README.md`, `docs/07-channel-integrations.md` §5, `docs/04`, `docs/05`, `docs/09`, `todo/T-097…T-104*.md`, `TODO.md` |
| Channel kinds | `packages/channels/src/website.ts` (new), `packages/channels/src/capabilities.ts` (new), `packages/channels/src/index.ts` |
| Contracts | `packages/contracts/src/channel/channel.schema.ts`, `packages/contracts/src/channel/website.schema.ts` (new), `packages/contracts/src/channel/channel.routes.ts`, `packages/contracts/src/webchat/*` (new), `packages/contracts/src/conversation/conversation.schema.ts`, `packages/contracts/src/index.ts` |
| DB | `packages/db/src/schema/channel.ts` (`settings` column), `packages/db/src/schema/webchat.ts` (new), `packages/db/src/schema/index.ts`, `packages/db/migrations/0025_webchat.sql` |
| Channel module | `channel.facade.ts`, `channel.facade.impl.ts`, `ports/channel-store.ts`, `persistence/channel.store.ts`, `interface/http/channel.controller.ts`, `domain/website-key.ts` (new), `MODULE.md` |
| Conversation module | `jobs/meta-inbox.processor.ts`, `conversation.facade.ts`, `conversation.facade.impl.ts`, `persistence/conversation.store.ts`, `media/safe-image-fetcher.ts` wiring, `MODULE.md` |
| CRM module | `crm.facade.ts` + impl/store (`upsertLeadByPhone`), `MODULE.md` |
| Webchat module (new) | `apps/backend/src/modules/webchat/**` |
| Shared | `packages/shared/src/phone.ts` (+ tests) |
| Widget (new app) | `apps/widget/**` |
| Dashboard | `apps/web/src/features/channel/**`, `apps/web/src/features/conversation/**`, i18n files |
| E2E | `apps/web/e2e/website-chat.spec.ts` (or the repo's live e2e folder, follow existing pattern) |

---

### Task 1 (T-097): Tasks, ADR and channel docs

**Files:**
- Create: `todo/T-097-…md` … `todo/T-104-…md` via `pnpm todo:new "<title>"` (8 tasks, titles below), then set T-097 `in-progress`, others `next`, owner `@agent:claude`, `feature_ids: [CHN-05]`, link the spec and plan.
- Create: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md` (use the `write-adr` skill format; see existing ADR-010 for shape).
- Modify: `docs/adr/README.md` (index line), `docs/07-channel-integrations.md` §5.

Task titles:
- T-097 Website chat: tasks, ADR and channel docs
- T-098 Generalize the inbox pipeline by channel capabilities
- T-099 Website connections: settings, site key and management API
- T-100 Webchat public API, visitors and rate limits
- T-101 Embeddable website chat widget
- T-102 Website lead capture into the CRM and inbox
- T-103 Dashboard: website channel management and install guide
- T-104 Website chat end-to-end tests and docs pass

- [ ] **Step 1:** Run `pnpm todo:new` for the 8 titles; fill each file's Context/Goal/Scope/Acceptance from the matching task in this plan (short, link the plan section).
- [ ] **Step 2:** Write ADR-011: Context (docs/07 §5 chose iframe + WS/SSE), Decision (single Shadow DOM script, ES2017 output, ≤ 20 KB gzip; polling on the api entry first, SSE later; visitor identity by HMAC-signed token), Consequences (host page JS can still interfere with globals → defensive code; page context readable without postMessage; polling load numbers: open 3–4 s, closed 20 s, paused when hidden), Alternatives (iframe, hybrid, SSE first).
- [ ] **Step 3:** Rewrite `docs/07` §5 to match the spec (embed snippet, Shadow DOM, polling, domain allowlist incl. subdomains, visitor token, rate limits, settings list). Link ADR-011.
- [ ] **Step 4:** `pnpm lint` (markdown formatting via prettier if configured: `pnpm format` on changed files only).
- [ ] **Step 5:** Commit `docs(channel): add website chat ADR, tasks and channel design (T-097)`.

---

### Task 2 (T-098): Generalize the inbox pipeline by channel capabilities (no behaviour change for Meta)

**Files:**
- Create: `packages/channels/src/capabilities.ts`, `packages/channels/src/website.ts`, `packages/channels/src/capabilities.test.ts`
- Modify: `packages/channels/src/index.ts`, `packages/contracts/src/channel/channel.schema.ts`, `packages/contracts/src/conversation/conversation.schema.ts`, `apps/backend/src/modules/channel/application/channel.facade.impl.ts`, `apps/backend/src/modules/channel/infrastructure/persistence/channel.store.ts` (provider casts), `apps/backend/src/modules/conversation/application/jobs/meta-inbox.processor.ts` (window check), `apps/backend/src/modules/conversation/application/conversation.facade.impl.ts` (send window check ~line 463), any `apps/web` code that switches on `MetaProvider` and breaks typecheck.

**Interfaces — Produces:**
```ts
// packages/channels/src/capabilities.ts
import type { ChannelCapabilities, ChannelKind } from './adapter.js';
export const META_CAPABILITIES: ChannelCapabilities = { richCards: true, quickReplies: true, media: true, replyWindowHours: 24 };
export const WEBSITE_CAPABILITIES: ChannelCapabilities = { richCards: false, quickReplies: true, media: true, replyWindowHours: null };
/** Capabilities by provider/kind. Unknown kinds get the strictest window (24 h). */
export function capabilitiesOf(kind: ChannelKind | string): ChannelCapabilities;
/** True when a reply to a customer message received at `lastCustomerAt` is still allowed at `now`. */
export function withinReplyWindow(kind: ChannelKind | string, lastCustomerAt: Date, now?: Date): boolean;

// packages/contracts/src/channel/channel.schema.ts
export const ChannelProvider = z.enum(['facebook', 'instagram', 'website']);
export type ChannelProvider = z.infer<typeof ChannelProvider>;
// ChannelConnectionDto.provider, ConversationDto.provider (and other DTO provider fields that describe a connection) become ChannelProvider.
// MetaProvider stays for OAuth/connect/discovery routes.
```
- `ChannelFacadeImpl.deliver(...)`: if `c.provider === 'website'` → return `{ externalId: null, status: 'sent', failureCode: null }` without network (status check `connected` still applies; a `disabled`/`disconnected` site returns `failed` with `failureCode: 'site_disabled'`).
- `presence(...)` and `fetchCustomerProfile(...)`: website → no-op / `null` (never construct `MetaAdapter`).
- `expiresAt` check stays Meta-only (website has `expiresAt = null` anyway).

- [ ] **Step 1: Failing tests** in `packages/channels/src/capabilities.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, withinReplyWindow } from './capabilities.js';
describe('capabilitiesOf', () => {
  it('gives Meta kinds a 24 h window', () => {
    expect(capabilitiesOf('facebook').replyWindowHours).toBe(24);
    expect(capabilitiesOf('instagram').replyWindowHours).toBe(24);
  });
  it('gives the website no window', () => expect(capabilitiesOf('website').replyWindowHours).toBeNull());
  it('treats unknown kinds as 24 h', () => expect(capabilitiesOf('nope').replyWindowHours).toBe(24));
});
describe('withinReplyWindow', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  it('closes Meta after 24 h', () => {
    expect(withinReplyWindow('facebook', new Date('2026-10-26T12:00:01Z'), now)).toBe(true);
    expect(withinReplyWindow('facebook', new Date('2026-10-26T12:00:00Z'), now)).toBe(false);
  });
  it('never closes the website', () =>
    expect(withinReplyWindow('website', new Date('2020-01-01T00:00:00Z'), now)).toBe(true));
});
```
Run `pnpm --filter @agent-sales/channels test` → FAIL (module missing).
- [ ] **Step 2:** Implement `capabilities.ts`, `website.ts` (exports `WEBSITE_CAPABILITIES` re-export + `WEBSITE_KIND = 'website' as const`), export from `index.ts`. Tests PASS.
- [ ] **Step 3:** Add `ChannelProvider` to contracts; switch connection/conversation DTO `provider` fields to it. Run `pnpm typecheck` at root and fix every break by widening types (web `platform-icon`, filters, etc.) — no behaviour change; website rows are simply not produced yet.
- [ ] **Step 4:** Replace the processor's `MESSAGING_WINDOW_MS` comparison (`meta-inbox.processor.ts` ~line 165) with `!withinReplyWindow(provider, job.event.occurredAt)`. The provider comes from `job.event.kind` (`NormalizedEvent.kind`). Same for any other window check in that file and for `conversation.facade.impl.ts` (the `'The 24-hour messaging window is closed'` branch: use the conversation's channel provider and its last customer message time with `withinReplyWindow`).
- [ ] **Step 5:** Website branches in `deliver`, `presence`, `fetchCustomerProfile` of `channel.facade.impl.ts`. Add a unit test (pattern: existing channel facade specs under `apps/backend/src/modules/channel/**/__tests__` or `*.spec.ts`; create one if none) using an in-memory store that returns a `provider: 'website'` record: `deliver` → `{status:'sent', externalId:null}` and the Meta adapter is never constructed (spy `globalThis.fetch` and assert not called).
- [ ] **Step 6:** Add a conversation-level test: staff `send` on a website conversation whose last customer message is 48 h old succeeds; the same on a facebook conversation still throws `CONFLICT` (existing Meta test proves the latter — do not edit it; add the website case next to it, building the website conversation with the existing test helpers).
- [ ] **Step 7:** `pnpm check` green. Commit `refactor(conversation): drive reply windows and delivery by channel capabilities (T-098)`.

---

### Task 3 (T-099): Website connections — settings, site key and management API

**Files:**
- Create: `packages/contracts/src/channel/website.schema.ts`, `apps/backend/src/modules/channel/domain/website-key.ts` (+ `website-key.spec.ts`), `packages/db/migrations/0025_webchat.sql` (only the `settings` column in this task; Task 4 appends the visitors table in a new migration `0026_webchat_visitors.sql`)
- Modify: `packages/db/src/schema/channel.ts`, `packages/contracts/src/channel/channel.routes.ts`, `packages/contracts/src/channel/channel.schema.ts` (`settings` on DTO), channel facade/impl/store/controller, `apps/backend/src/modules/channel/MODULE.md`, `docs/05-data-model.md`.

**Interfaces — Produces:**
```ts
// packages/contracts/src/channel/website.schema.ts
export const Hostname = z.string().trim().toLowerCase().min(1).max(253)
  .regex(/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/); // no scheme, no path, no port; 'localhost' allowed
export const WebsiteSettings = z.object({
  domains: z.array(Hostname).min(1).max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#F97316'),        // Rapiz orange
  position: z.enum(['left', 'right']).default('right'),
  agentName: z.string().trim().min(1).max(60).default('Tư vấn viên'),
  avatarUrl: z.url({ protocol: /^https$/ }).nullable().default(null),
  greeting: z.string().trim().min(1).max(300).default('Chào anh/chị, em có thể hỗ trợ gì ạ?'),
  phonePrompt: z.string().trim().max(300).default('Anh/chị để lại số điện thoại để bên em gọi tư vấn kỹ hơn nhé.'),
  phoneChipText: z.string().trim().min(1).max(60).default('Gửi số điện thoại để được gọi lại'),
  requirePhoneAfter: z.number().int().min(0).max(20).default(0),
});
export type WebsiteSettings = z.infer<typeof WebsiteSettings>;
export const CreateWebsiteRequest = z.object({
  name: z.string().trim().min(1).max(100),
  domains: WebsiteSettings.shape.domains,
  botId: z.uuid().nullable().optional(),
});
export const UpdateWebsiteRequest = WebsiteSettings.partial().extend({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});
// ChannelConnectionDto gains: settings: WebsiteSettings.nullable().default(null)
// ChannelConnectionDto.status enum gains 'disabled'.

// Routes (workspace-scoped, auth):
//   POST  /channels/website            body CreateWebsiteRequest  → 201 ChannelConnectionDto
//   PATCH /channels/{id}/website       body UpdateWebsiteRequest  → 200 ChannelConnectionDto
// Existing PATCH /channels/{id} (bind bot / disconnect) works for websites unchanged.

// apps/backend/src/modules/channel/domain/website-key.ts
export function newSiteKey(): string;                 // 'wk_' + 22 base62 chars from crypto.randomBytes
export function isSiteKey(v: string): boolean;        // /^wk_[0-9A-Za-z]{22}$/
export function signVisitor(secret: Buffer, visitorId: string): string;          // 'v1.<visitorId>.<base64url hmac-sha256>'
export function verifyVisitor(secret: Buffer, token: string): string | null;     // visitorId or null; constant-time compare
export function hostAllowed(origin: string | undefined, domains: readonly string[]): boolean;
// origin 'https://shop.example.vn:8443' → host 'shop.example.vn'; allowed if host === d or host.endsWith('.' + d); case-insensitive; undefined/'null' → false

// ChannelFacade additions (api/channel.facade.ts):
export interface WebsiteSite {
  workspaceId: WorkspaceId; connectionId: string; siteKey: string; name: string;
  status: 'connected' | 'disabled' | 'disconnected' | 'reauth_required';
  botId: string | null; settings: WebsiteSettings;
}
createWebsite(ws: WorkspaceId, input: CreateWebsiteRequest): Promise<ChannelConnectionDto>;
updateWebsite(ws: WorkspaceId, id: string, input: UpdateWebsiteRequest): Promise<ChannelConnectionDto>;
/** Public lookup by site key (system role). null when unknown. */
resolveWebsite(siteKey: string): Promise<WebsiteSite | null>;
signVisitorToken(site: WebsiteSite, visitorId: string): Promise<string>;
verifyVisitorToken(site: WebsiteSite, token: string): Promise<string | null>;
/** Writes a website customer event into channel_webhook_events; false when (connection, externalEventId) already exists. */
enqueueWebsiteEvent(site: WebsiteSite, event: NormalizedEvent): Promise<boolean>;
/** True while the visitor has an unprocessed message event (drives the widget's typing dots). */
hasPendingCustomerEvent(connectionId: string, senderExternalId: string): Promise<boolean>;
```
- `token_sealed` for a website = `box.seal(randomBytes(32).toString('base64'))`; the secret never leaves the module. Cache opened secrets in a small in-process `Map<connectionId, Buffer>` (bounded, 1,000 entries).
- `createWebsite`: validates `botId` via `bots.getBot` when provided; inserts `{ provider: 'website', externalId: newSiteKey(), name, status: 'connected', settings: WebsiteSettings.parse({ domains }), tokenSealed, expiresAt: null }`.
- `updateWebsite`: 404 when not a website; merges settings and re-parses with `WebsiteSettings`; `enabled: false` → `status 'disabled'`, `true` → `'connected'`.
- `resolveWebsite`: `withSystem` select by `(provider='website', external_id=siteKey)`; settings parsed with `WebsiteSettings` (fallback to defaults with the stored domains on parse failure).
- The `MetaIngressStore` and Meta webhooks must keep ignoring website rows (they filter by provider already — verify).
- Migration `0025_webchat.sql`: `ALTER TABLE channel_connections ADD COLUMN settings jsonb;` (follow how other migrations are registered — check `packages/db/src/migrate.ts` / journal).

- [ ] **Step 1: Failing unit tests** `website-key.spec.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hostAllowed, isSiteKey, newSiteKey, signVisitor, verifyVisitor } from './website-key.js';
describe('site key', () => {
  it('has the public shape', () => { const k = newSiteKey(); expect(isSiteKey(k)).toBe(true); expect(newSiteKey()).not.toBe(k); });
});
describe('visitor token', () => {
  const secret = randomBytes(32), other = randomBytes(32), id = '0192f0c8-7b1e-7cc0-9a51-3c1b2b8a9d10';
  it('round-trips', () => expect(verifyVisitor(secret, signVisitor(secret, id))).toBe(id));
  it('rejects another site', () => expect(verifyVisitor(other, signVisitor(secret, id))).toBeNull());
  it('rejects tampering', () => {
    const t = signVisitor(secret, id);
    expect(verifyVisitor(secret, t.replace(id, '0192f0c8-7b1e-7cc0-9a51-3c1b2b8a9d11'))).toBeNull();
    expect(verifyVisitor(secret, 'v2.' + t.slice(3))).toBeNull();
    expect(verifyVisitor(secret, 'garbage')).toBeNull();
  });
});
describe('hostAllowed', () => {
  const d = ['shop.vn'];
  it('matches exact host and subdomains, ignoring scheme, port and case', () => {
    expect(hostAllowed('https://shop.vn', d)).toBe(true);
    expect(hostAllowed('https://WWW.Shop.vn:8443', d)).toBe(true);
    expect(hostAllowed('http://a.b.shop.vn', d)).toBe(true);
  });
  it('rejects look-alikes and missing origins', () => {
    expect(hostAllowed('https://evilshop.vn', d)).toBe(false);
    expect(hostAllowed('https://shop.vn.evil.com', d)).toBe(false);
    expect(hostAllowed(undefined, d)).toBe(false);
    expect(hostAllowed('null', d)).toBe(false);
  });
});
```
- [ ] **Step 2:** Implement `website-key.ts` (`createHmac('sha256')`, `timingSafeEqual` on equal-length buffers, UUID shape check on visitorId). PASS.
- [ ] **Step 3:** Contracts + DB column + migration; facade/store/controller methods above. Contract tests for `WebsiteSettings` defaults and `Hostname` rejecting `https://x.vn`, `x.vn/path`, `x.vn:80`.
- [ ] **Step 4: Integration test** `apps/backend/test/website-channel.integration.spec.ts` (use `test/support/harness.ts` like `inbox-v2.integration.spec.ts`): owner creates a website → 201 with `provider:'website'`, `externalId` matching `/^wk_/`, `settings.domains`; PATCH settings → color changes; `enabled:false` → `status:'disabled'`; second workspace cannot read/patch it (404); `GET /channels` lists it.
- [ ] **Step 5:** Update `channel/MODULE.md` (website provider, secret rule, new facade methods) and `docs/05` (`settings`). Run backend typecheck/test + this integration spec. Commit `feat(channel): website connections with site key, settings and visitor signing (T-099)`.

---

### Task 4 (T-100): Webchat module — public API, visitors and rate limits

**Files:**
- Generate: `pnpm gen module webchat` (then fill). Register `WebchatModule` in `apps/backend/src/app.module.ts`.
- Create: `packages/db/src/schema/webchat.ts`, `packages/db/migrations/0026_webchat_visitors.sql`, `packages/contracts/src/webchat/webchat.schema.ts`, `packages/contracts/src/webchat/webchat.routes.ts`, `apps/backend/src/modules/webchat/application/rate-limiter.ts` (port + in-memory impl), `…/application/webchat.service.ts`, `…/interface/http/webchat-public.controller.ts`, `…/interface/http/webchat.controller.ts` (authed, side panel), `…/infrastructure/persistence/visitor.store.ts`, `…/infrastructure/media/s3-webchat-upload-storage.ts`, `…/MODULE.md`.
- Modify: conversation facade (`listForVisitor`), `apps/backend/src/modules/conversation/conversation.module.ts` (SafeImageFetcher allowlist gets the S3 public host), `docs/04`, `docs/09`.

**Interfaces — Consumes:** Task 3 `ChannelFacade.resolveWebsite/signVisitorToken/verifyVisitorToken/enqueueWebsiteEvent/hasPendingCustomerEvent`, `hostAllowed`.

**Interfaces — Produces:**
```ts
// packages/contracts/src/webchat/webchat.schema.ts
export const WidgetConfigDto = z.object({
  color: z.string(), position: z.enum(['left','right']), agentName: z.string(),
  avatarUrl: z.string().nullable(), greeting: z.string(), phonePrompt: z.string(),
  phoneChipText: z.string(), language: z.enum(['vi','en']),
});
export const WidgetMessageDto = z.object({
  id: z.uuid(), role: z.enum(['customer','agent']), text: z.string(), imageUrl: z.string().nullable(), at: z.iso.datetime(),
});
export const WidgetSendRequest = z.object({
  clientMessageId: z.uuid(),
  text: z.string().trim().max(2000).optional(),
  attachmentUrl: z.url({ protocol: /^https$/ }).optional(),
  page: z.object({ url: z.string().max(1000), title: z.string().max(150) }),
  firstUrl: z.string().max(1000).optional(),
  referrer: z.string().max(500).optional(),
  /** Greeting + invites the visitor saw before writing; stored with the first message. */
  seen: z.array(z.string().max(300)).max(5).optional(),
}).refine((b) => Boolean(b.text) !== Boolean(b.attachmentUrl), 'text or attachmentUrl, not both');
export const WidgetSendResponse = z.object({ visitorToken: z.string(), message: WidgetMessageDto });
export const WidgetPollResponse = z.object({
  messages: z.array(WidgetMessageDto), botTyping: z.boolean(),
  phoneCaptured: z.boolean(), phoneRequired: z.boolean(),
});
export const WidgetUploadResponse = z.object({ url: z.string() });
export const WidgetPhoneRequest = z.object({ phone: z.string().trim().min(6).max(30) });
export const WebsiteVisitorDto = z.object({
  firstUrl: z.string().nullable(), referrer: z.string().nullable(),
  lastUrl: z.string().nullable(), lastTitle: z.string().nullable(),
  phone: z.string().nullable(), contactId: z.uuid().nullable(), createdAt: z.iso.datetime(),
});

// Public routes (no auth, @Public(), NOT workspace-scoped), prefix as other routes (/api/v1):
// GET  /webchat/v1/sites/{key}                 → 200 WidgetConfigDto
// POST /webchat/v1/sites/{key}/messages        → 202 WidgetSendResponse   (Authorization: Visitor <token> optional)
// GET  /webchat/v1/sites/{key}/messages?after= → 200 WidgetPollResponse   (token required)
// POST /webchat/v1/sites/{key}/uploads         → 200 WidgetUploadResponse (multipart field 'file'; token required)
// POST /webchat/v1/sites/{key}/phone           → 200 { phoneCaptured: true }  (Task 6 implements; Task 4 returns 501)
// Authed: GET /webchat/conversations/{conversationId}/visitor → 200 WebsiteVisitorDto | 404

// ConversationFacade addition:
listForVisitor(ws: WorkspaceId, channelId: string, customerId: string, afterMessageId: string | null, limit?: number):
  Promise<{ conversationId: string | null; messages: WidgetMessageDto[] }>;
// Only inbound customer messages and outbound bot/staff messages with status 'sent'; never notes; agent role for both bot and staff;
// ordered by id (UUIDv7) ascending; after = exclusive cursor; default limit 50.

// apps/backend/src/modules/webchat/application/rate-limiter.ts
export interface RateLimiter { hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } }
export class InMemoryRateLimiter implements RateLimiter { /* fixed window per key, Map with periodic sweep, max 50k keys */ }
export const RATE_LIMITER = Symbol('RATE_LIMITER');
```
Behaviour (webchat.service.ts):
- Every public call: `site = channels.resolveWebsite(key)`; `!site || site.status !== 'connected' || !hostAllowed(req.headers.origin, site.settings.domains)` → **404** `{ error: 'NOT_FOUND' }`. Set CORS headers on every public response for the allowed origin (`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, allow headers `Authorization, Content-Type`, methods `GET, POST, OPTIONS`); answer `OPTIONS` preflight (204) for allowed origins. Check whether the app already registers `@fastify/cors` globally (`bootstrap.ts`) and make sure it does not override these routes.
- `GET /` config: language from the bound bot (`bots.getBot(...).language`, default `vi`); cache `WidgetConfigDto` per key for 60 s in memory.
- `POST /messages`: verify token if present (invalid → 401 `INVALID_VISITOR`); no token → create visitor (`visitorId = newId()` UUIDv7, row in `webchat_visitors` with `first_url`, `referrer`, `last_url`, `last_title`), token = `signVisitorToken`. Rate limits (keys `v:<visitorId>`, `ip:<sha256(ip+daily salt)>`, `site:<connectionId>:new`) per spec table; exceeded → **429** with `Retry-After` seconds. Build `NormalizedEvent { kind:'website', assetExternalId: site.siteKey, externalEventId: clientMessageId, externalMessageId: clientMessageId, type:'message', senderExternalId: visitorId, occurredAt: new Date(), text?, attachments?: [{type:'image', url}], raw: { page, seen } }` → `enqueueWebsiteEvent`. Update `last_url/last_title/last_seen_at`. Response 202 with the message echo (`role:'customer'`, `id` = a UUID the widget can de-dup by `clientMessageId` — return `id: clientMessageId`).
  - Make sure `conversation.receive(...)` handles a website event: customer name = `Khách website` + last 4 chars of visitorId when no profile (look at how `receive` names Meta customers and add the website branch), and it must not call Meta profile fetch (Task 2 made `fetchCustomerProfile` return null).
  - `seen` (greeting) is stored on the conversation only if `receive` supports it cheaply; otherwise keep it in the event `raw` and log nothing. Do not block on it.
- `GET /messages`: token required (401 otherwise); visitor's conversation via `listForVisitor(site.workspaceId, site.connectionId, visitorId, after)`; `botTyping = hasPendingCustomerEvent(connectionId, visitorId)`; `phoneCaptured = visitor.phone_e164 != null`; `phoneRequired` = false in this task (Task 6). Poll rate limit per IP + visitor.
- `POST /uploads`: token required; only `image/jpeg|png|webp|gif` checked by magic bytes; ≤ 5 MB; stored under `webchat/<workspaceId>/<connectionId>/<uuid>.<ext>` via an S3 storage adapter following `apps/backend/src/modules/knowledge/infrastructure/s3-bot-media-storage.ts` (copy the pattern into webchat infrastructure — do not import knowledge internals); returns the public HTTPS URL (`S3_PUBLIC_URL`). Without S3 config → 503 `UNAVAILABLE`. Add the `S3_PUBLIC_URL` host to the `SafeImageFetcher` allowlist in `conversation.module.ts` so the bot can see customer images.
- Table `webchat_visitors` (spec "Data model"); `tenantPolicies('webchat_visitors')`; unique `(connection_id, id)`; index `(workspace_id, conversation_id)`. Store fills `conversation_id` lazily (on first poll that finds a conversation, or via `listForVisitor` result).

- [ ] **Step 1: Failing unit tests**: `rate-limiter.spec.ts` (limit reached → `ok:false` with `retryAfterMs > 0`; window reset after `windowMs` using fake timers); `webchat.service.spec.ts` with fakes for `ChannelFacade`, `ConversationFacade`, visitor store: unknown key → 404; wrong origin → 404; disabled → 404; first send creates visitor + returns token + calls `enqueueWebsiteEvent` with `kind:'website'` and `externalEventId === clientMessageId`; bad token → 401; 6th message within a second → 429.
- [ ] **Step 2:** Implement contracts, schema, migration, store, limiter, service, controllers until green.
- [ ] **Step 3: Integration test** `apps/backend/test/webchat.integration.spec.ts` (harness + real Postgres): create website via API (owner) with domain `shop.test`, bind a bot; `POST messages` with `Origin: https://shop.test` → 202 + token; same `clientMessageId` again → still one row in `channel_webhook_events`; run the inbox processor once with a fake AI (see how `inbox-v2.integration.spec.ts` / `meta-inbox-http.spec.ts` drive the processor and stub AI) → poll returns the customer message and the bot answer (`role:'agent'`); staff `send` via `/conversations/{id}/messages` → visible on next poll; origin `https://evil.test` → 404; second workspace cannot see the visitor row (RLS); authed visitor route returns `firstUrl`.
- [ ] **Step 4:** `webchat/MODULE.md`, `docs/04` (public widget surface), `docs/09` (visitor token, no IP storage, in-memory rate limit deviation). `pnpm check` green. Commit `feat(webchat): public widget API with visitor tokens, origin check and rate limits (T-100)`.

---

### Task 5 (T-101): Embeddable website chat widget (`apps/widget`)

**Files (new app):** `apps/widget/package.json` (`@agent-sales/widget`, scripts: `build` = esbuild bundle, `test` = vitest jsdom, `typecheck`, `lint`, `size` = gzip-size check, `syntax` = `es-check es2017 dist/widget.js`), `apps/widget/tsconfig.json`, `apps/widget/src/index.ts` (bootstrap), `src/api.ts` (fetch client), `src/state.ts` (pure state machine), `src/poller.ts`, `src/storage.ts` (try/catch localStorage/sessionStorage), `src/view.ts` (DOM rendering in shadow root), `src/styles.ts` (CSS string), `src/phone.ts` (re-export from `@agent-sales/shared` phone helpers — bundled), `src/strings.ts` (vi/en copy), tests next to files, `apps/widget/README.md`, `apps/widget/dev/index.html` (manual test host page).
- Wire into turbo (`turbo.json` tasks already generic — confirm `build`/`test`/`typecheck`/`lint` pick it up) and add `size`+`syntax` to the widget's `build` script chain so CI enforces them.

**Interfaces — Consumes:** Task 4 public routes and DTO shapes (copy the TS types from `@agent-sales/contracts` as `import type` only — must not bundle zod; verify bundle has no zod).

Behaviour (spec "Widget behaviour"):
- Read `key` from `document.currentScript.src` (fallback: last `<script>` whose src contains `widget.js`); API origin = script origin unless `data-api` attribute is set. Guard `window.__rapizWidget`.
- One `GET /` on load. Non-2xx 4xx → do not render. Network/5xx → render with built-in defaults.
- Shadow root (`attachShadow({mode:'open'})`, fallback to the host element), host element `position:fixed; z-index:2147483000`.
- Bubble (left/right, color), unread badge, panel (header with avatar/agentName, close), message list, input + send, image button (compress to ≤ 1600 px JPEG 0.8 via canvas, then `POST /uploads`, then send with `attachmentUrl`), phone chip after the first agent message (until `phoneCaptured`), phone-only mode (Task 6 enables via `phoneRequired`; keep the UI path ready: chip tap → phone input → `POST /phone`).
- Greeting shown as the first agent bubble locally; sent as `seen` with the first message.
- Outgoing message gets `clientMessageId = crypto.randomUUID()` (fallback generator for old browsers), shown immediately as pending; retried with the same id on network error (max 3, backoff 2/4/8 s); 429 → show `strings.rateLimited`.
- Poller: start only after the first send or when a stored token exists; intervals open+awaiting 3 s, open 4 s, closed 20 s; pause on `document.hidden`; backoff ×2 to 60 s on errors; `after` = last message id. New agent message while closed → badge +1 and short sound (respect a mute, no sound if `prefers-reduced-motion`? — sound is independent; play only after a user gesture has happened on the page).
- Typing dots while `botTyping`.
- Token in `localStorage['rapiz_v_' + key]`; 401 from API → drop token, next send starts a new visitor.
- Mobile ≤ 640 px: full-screen panel; keep input visible with `visualViewport` resize listener. No zoom lock. `prefers-reduced-motion` disables animations. Text via `textContent` only (never `innerHTML` with server data). Links in agent text are not auto-linked in this version.
- ES2017 output: esbuild `target: ['es2017','safari11']`; no lookbehind regexes in widget source (the shared phone module must also avoid them — check).
- Budget: `dist/widget.js` ≤ 20 KB gzip (script fails the build above that).

- [ ] **Step 1: Failing tests** (`vitest`, `environment: 'jsdom'`): `state.test.ts` — reducer transitions: `closed→open`, `send` adds pending message, `ack` replaces pending by id, `poll` merges messages de-duplicated by id and increments `unread` only when closed and role agent, `phoneRequired` switches input mode to `phone`; `poller.test.ts` with fake timers — 3 s/4 s/20 s cadence by state, paused when hidden, backoff to 60 s; `index.test.ts` — a 404 config response renders nothing; 200 renders a shadow host with the bubble.
- [ ] **Step 2:** Implement until green. `pnpm --filter @agent-sales/widget build` produces `dist/widget.js`; size and syntax checks pass.
- [ ] **Step 3:** Manual smoke (optional but recommended): `apps/widget/dev/index.html` loads `../dist/widget.js?key=…` with `data-api` pointing at a local api; document how in `apps/widget/README.md`.
- [ ] **Step 4:** Commit `feat(widget): embeddable website chat bubble in Shadow DOM (T-101)`.

---

### Task 6 (T-102): Website lead capture into the CRM and inbox

**Files:**
- Modify: `packages/shared/src/phone.ts` (+ `phone.test.ts`), crm facade/impl/store (`upsertLeadByPhone`), `crm/MODULE.md`, conversation facade/impl (`linkLead`, `lead` on DTO, reply-context line), `packages/contracts/src/conversation/conversation.schema.ts` (`lead`), webchat service (`/phone`, text extraction, `phoneRequired`, 409), webchat visitor store, widget (`phoneRequired` UI already prepared — switch it on), `apps/web/src/features/conversation/**` (badge + notification + visitor side panel).

**Interfaces — Produces:**
```ts
// packages/shared/src/phone.ts
/** Legacy 11-digit mobile prefixes mapped to today's 10-digit ones (0168 → 038 …). */
// normalizeVnPhone additionally: maps legacy prefixes; rejects PLACEHOLDER_PHONES.
export const PLACEHOLDER_PHONES: readonly string[]; // ['0987654321','0123456789','0909090909','0912345678','0000000000','1234567890'] (national form)
export function findVnPhone(text: string): string | null; // first valid VN mobile in free text, E.164; no regex lookbehind

// crm facade
upsertLeadByPhone(ws: WorkspaceId, input: {
  phoneE164: string; sourceKey: 'website'; displayName: string; firstUrl: string | null;
}): Promise<{ contactId: string; created: boolean }>;
// find by normalized phone; else create (name displayName, source by key 'website', phone). Existing: keep source, append history entry
// "lead captured from website" (field 'lead', from null to firstUrl ?? 'website'). Idempotent under concurrency (catch unique violation / advisory lock on hash(phone)).

// conversation facade
linkLead(ws: WorkspaceId, conversationId: string, lead: { contactId: string; phoneE164: string; capturedAt: string }): Promise<void>;
// ConversationDto.lead: z.object({ contactId: z.uuid(), phone: z.string(), capturedAt: z.iso.datetime(), seenAt: z.iso.datetime().nullable() }).nullable().default(null)
// lead.seenAt set when staff mark the conversation read (reuse markRead) → "Số mới" badge = lead && !seenAt.
```
Behaviour:
- `POST /phone`: token required; `normalizeVnPhone`; invalid → 422 `INVALID_PHONE`; else capture (below) → 200 `{ phoneCaptured: true }`.
- `POST /messages` with text: `findVnPhone(text)` hit → capture in the same request (message still enqueued normally).
- Capture: `crm.upsertLeadByPhone(ws, { phoneE164, sourceKey:'website', displayName: 'Khách website ' + last4, firstUrl })` → update visitor (`phone_e164`, `contact_id`, `phone_captured_at`) → if the visitor has a conversation, `conversation.linkLead(...)`; if not yet (message still queued), link on the next poll that finds the conversation (store `contact_id` on the visitor and link lazily, idempotent).
- `phoneRequired`: `settings.requirePhoneAfter > 0 && !phone && customerMessageCount(visitor) >= requirePhoneAfter`; poll returns it; `POST /messages` with text while required → **409** `PHONE_REQUIRED` (images also blocked).
- Bot context: in `getReplyContext` (or where the system prompt is assembled for a conversation), when `lead` is set add one system line: `The customer already left their phone number; do not ask for it again.` (English instruction; keep it in the same place other system lines live).
- Dashboard inbox: list row badge `Số mới` (i18n key) when `lead && !lead.seenAt`; when the existing list refetch brings a conversation with a new unseen lead id not seen before in this tab → play a short sound and `new Notification(...)` if permission granted; a small "Bật thông báo" button in the inbox header requests permission once. Conversation side panel for website conversations shows `WebsiteVisitorDto` (first page, current page, referrer, phone) via `GET /webchat/conversations/{id}/visitor`.

- [ ] **Step 1: Failing tests**: `phone.test.ts` table — `findVnPhone('em sdt 0912 345 679 nhé')→'+84912345679'`, `'+84 38 123 4567'`, `'84381234567'`, legacy `'01681234567'→'+84381234567'`, placeholders `'0987654321'→null`, `'gọi 0901.234.568'`, `'abc'→null`, landline `'02838123456'→null`; existing tests unchanged. crm unit/integration: two concurrent `upsertLeadByPhone` with the same phone → one contact; existing contact keeps its source. webchat service: phone in text captures; invalid `/phone` → 422; `requirePhoneAfter: 2` → after 2 messages poll says `phoneRequired` and 3rd text → 409.
- [ ] **Step 2:** Implement until green; widget: enable phone-required mode from poll response; widget tests for it.
- [ ] **Step 3:** Integration (extend `webchat.integration.spec.ts`): visitor leaves phone → `/contacts/query` finds it with source website; conversation DTO has `lead`; marking read sets `seenAt`.
- [ ] **Step 4:** Web unit tests (vitest + testing-library, follow `apps/web` patterns) for the badge and the side panel. Update `crm/MODULE.md`, `conversation/MODULE.md`, `webchat/MODULE.md`. `pnpm check` green. Commit `feat(webchat): capture website leads into the CRM and flag them in the inbox (T-102)`.

---

### Task 7 (T-103): Dashboard — website channel management and install guide

**Files:** `apps/web/src/features/channel/lib/integrations.ts` (website enabled in WORKSPACE_PLATFORMS and BOT_PLATFORMS, not coming soon), `apps/web/src/features/channel/api/channels.ts` (`createWebsite`, `updateWebsite` hooks), new `components/website-create-dialog.tsx`, `components/website-settings-panel.tsx`, `components/website-embed-code.tsx`, `components/website-install-guide.tsx`, `components/website-preview.tsx`, connection card website variant, i18n strings (vi + en), tests next to components.

Behaviour:
- Integrations page, platform "Website": button "Thêm website" → dialog (name, domains as chips/comma list validated with `Hostname`, bot select). Card shows name, domains, status (Đang chạy / Đang tắt), actions: copy embed code, settings, enable/disable, disconnect.
- Embed code: `<script src="{WIDGET_URL}?key={externalId}" async></script>` where `WIDGET_URL` comes from web env `VITE_WIDGET_URL` (add to the web env schema with a dev default `http://localhost:5174/widget.js` or the path you serve `apps/widget/dist` from — document it). Copy button with "Đã chép".
- Settings panel: color, position, agentName, avatarUrl, greeting, phonePrompt, phoneChipText, requirePhoneAfter, domains; save via PATCH; form validated with the contract schema.
- Live preview: a styled static mock of the bubble + panel using the current unsaved settings (pure React; do not load the real widget — keeps it testable). 
- Install guide: tabs/accordion with short Vietnamese steps for HTML, WordPress, LadiPage, Haravan, Sapo, Shopify, Wix, Google Tag Manager (content from the spec/analysis: paste before `</body>`; GTM: Custom HTML tag, trigger All Pages).
- [ ] **Step 1: Failing tests**: `integrations.test.ts` — website no longer coming soon and listed; dialog validates domains (rejects `https://x.vn/a`); embed code renders the key; settings save calls PATCH with changed fields only.
- [ ] **Step 2:** Implement until green; `pnpm --filter @agent-sales/web test`, `typecheck`, `lint`.
- [ ] **Step 3:** Commit `feat(web): manage website chat channels with embed code, settings and install guide (T-103)`.

---

### Task 8 (T-104): End-to-end tests and docs pass

**Files:** `apps/web/e2e/website-chat.spec.ts` (follow existing Playwright config and live-backend pattern in `apps/web/e2e*`; if the e2e suite cannot run a real backend in this repo, write the spec against the same mocks the other e2e specs use and state it), `docs/02` (CHN-05 status), `docs/03` (widget route), `docs/07`, `docs/meta-inbox.md` (capability-driven window), `apps/web/README.md`, `todo/T-097…T-104` logs + statuses, `TODO.md`.
- [ ] **Step 1:** E2E: host page with the built widget → visitor writes → (stubbed) bot answer appears → staff answers from the inbox → visitor sees it → visitor leaves a phone → contact visible in CRM and "Số mới" badge in inbox.
- [ ] **Step 2:** Docs pass listed above; every module `MODULE.md` touched is current.
- [ ] **Step 3:** `pnpm check` green; run all new integration specs. Record results in each task file Log; set tasks to `review`.
- [ ] **Step 4:** Commit `test(webchat): end-to-end website chat journey and docs pass (T-104)`.
