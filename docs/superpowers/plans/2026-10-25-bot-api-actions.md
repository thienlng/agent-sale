# Bot API actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Shop owners declare HTTP APIs ("actions") the bot may call mid-conversation, with a confirmation gate for writes and a hardened server-side executor.

**Architecture:** New backend module `action` (facade + executor + persistence), orchestrated from `PlaygroundService` through a bounded call loop; model never touches the network. Web feature `action` mirrors Bizfly's list + form.

**Tech Stack:** NestJS, Drizzle/Postgres RLS, Zod contracts, Vitest (+ Testcontainers), React/TanStack, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-10-25-bot-api-actions-design.md` (read it fully first).

## Global Constraints

- Code, comments, commits, docs in English; UI strings via i18n (vi + en).
- Follow `docs/ARCHITECTURE.md`; create the module with `pnpm gen module action` (see T-021: if the root script fails use `pnpm turbo gen module --args action`); `pnpm arch` must pass.
- Mirror the `knowledge` module (training items) for facade/persistence/in-memory repo/unit-of-work and the bot controller ownership check pattern.
- RLS on every new table (`workspace_id`, forced RLS, same policy style as migration 0008/0012); additive migration `0015_bot_actions.sql`.
- Secrets only through `common/security/secret-box.ts`; never in DTOs, logs, prompts, `action_runs`.
- Every commit: Conventional Commit subject, footer `Refs: T-055`, then `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Local commits only; no push.
- Subagents run with `model: "sonnet"`. TDD: failing test first. `pnpm check` green before claiming done. Do not touch T-054 files (typography) in the working tree.

## Shared interfaces (fixed names — every task uses exactly these)

```ts
// packages/contracts/src/action/index.ts
export const ActionParamType = z.enum(['string', 'number', 'boolean']);
export const ActionParamLocation = z.enum(['path', 'query', 'header', 'body']);
export const ActionParam = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/), type: ActionParamType,
  location: ActionParamLocation, required: z.boolean(), description: z.string().min(1).max(300) });
export const ActionResponseField = z.object({ name: z.string().min(1).max(60), type: z.enum(['string','number','boolean','object','array']), description: z.string().min(1).max(300) });
export const ActionResponse = z.object({ statusCode: z.number().int().min(100).max(599), fields: z.array(ActionResponseField).max(30) });
export const ActionAuth = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('api_key'), headerName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,39}$/) }),
  z.object({ kind: z.literal('bearer') }) ]);
export const ActionMethod = z.enum(['GET','POST','PUT','PATCH','DELETE']);
// ActionInput = { name(1-80), description(1-1000), url(https URL, may contain {param}), method, params[≤20], responses[≤10],
//   auth: ActionAuth, authSecret?: string (write-only), requiresConfirm: boolean, enabled: boolean }
// ActionDto = ActionInput minus authSecret, plus { id, botId, hasSecret: boolean, createdAt, updatedAt }
// ActionTestRequest = { args: Record<string, string|number|boolean> };  ActionTestResult = { ok, statusCode|null, data|null, errorCode|null, latencyMs }

// apps/backend/src/modules/action/api/action.facade.ts
export const ACTION_FACADE = Symbol('ACTION_FACADE');
export interface ActionFacade {
  list(ws: WorkspaceId, botId: string): Promise<ActionDto[]>;
  get(ws, botId, id): Promise<ActionDto>;
  create(ws, botId, input: ActionInput): Promise<ActionDto>;
  update(ws, botId, id, patch: Partial<ActionInput>): Promise<ActionDto>;
  remove(ws, botId, id): Promise<void>;
  test(ws, botId, id, args): Promise<ActionTestResult>;                 // executor, is_test run
  listForBot(ws, botId): Promise<BotActionView[]>;                      // enabled only, for prompts
  invoke(ws, botId, call: { actionId; args; conversationId: string|null; idempotencyKey: string; isTest: boolean }): Promise<ActionOutcome>;
  getPending(ws, conversationId): Promise<PendingAction|null>;
  setPending(ws, conversationId, p: { actionId; args }): Promise<void>;
  clearPending(ws, conversationId): Promise<void>;
}
export interface BotActionView { id; name; description; method; requiresConfirm; params: ActionParam[]; responseFields: {name,type,description}[] }
export type ActionOutcome = { ok: true; statusCode: number; data: unknown } | { ok: false; errorCode: 'timeout'|'blocked_host'|'too_large'|'bad_status'|'invalid_args'|'network'|'disabled'|'not_found'; statusCode?: number };
export interface PendingAction { actionId: string; args: Record<string, string|number|boolean>; expiresAt: Date }

// apps/backend/src/modules/action/domain/safe-http.ts (pure, injectable resolver/transport for tests)
export interface SafeHttpRequest { url: string; method: string; headers: Record<string,string>; body?: string }
export interface SafeHttpResult { ok: true; status: number; json: unknown } | { ok: false; errorCode: ... }
export function createSafeHttp(deps?: { resolve?: (host) => Promise<string[]>; transport?: ...; allowHttpHosts?: string[] }): (req: SafeHttpRequest) => Promise<SafeHttpResult>;
```

## Tasks

### Task 1: Contracts, DB schema, module scaffold, CRUD (+ web-facing HTTP)
**Files:** create `packages/contracts/src/action/index.ts` (+export in `index.ts`), `packages/db/src/schema/action.ts` (+ export, migration `0015_bot_actions.sql`, tables `bot_actions`, `action_runs`, `action_pending` per spec), module `apps/backend/src/modules/action/**` (generated), bot controller routes `/bots/:botId/actions` (GET/POST/GET:id/PATCH/DELETE/POST:id/test) with ownership check, `MODULE.md`.
**Produces:** contracts above; `ACTION_FACADE` CRUD + in-memory + Drizzle repo; secret sealed on write, `hasSecret` on read; `test()` temporarily returns `errorCode:'network'` until Task 3 wires the executor.
- [ ] Failing tests: contracts (valid/invalid params, `{param}` placeholders must match a `path` param, https-only URL), facade CRUD with in-memory repo (secret never in DTO; update without `authSecret` keeps secret; `authSecret:''` clears), integration test for RLS cross-tenant isolation on 3 tables (`*.integration.spec.ts`).
- [ ] Implement; run `pnpm arch`, backend unit + integration tests; commit `feat(action): …`.

### Task 2: Safe HTTP executor (independent of Task 1)
**Files:** create `apps/backend/src/modules/action/domain/safe-http.ts`, `domain/ip-guard.ts`, tests `__tests__/safe-http.spec.ts`, `ip-guard.spec.ts`.
**Produces:** `createSafeHttp`, `isPublicAddress(ip: string): boolean`.
- [ ] Failing tests (matrix): blocked → 127.0.0.1, 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254.169.254, 0.0.0.0, ::1, fc00::/7, fe80::/10, ::ffff:127.0.0.1, ff00::/8, hostnames resolving to any blocked address (any one bad address blocks), `http:` in production, redirects (3xx returned as `bad_status`, never followed), DNS rebinding (second resolution not used: connection uses the validated IP), body > 256 KB aborts `too_large`, timeout 8 s → `timeout`, non-JSON → `bad_status`-class error `bad_status`.
- [ ] Implement with `node:dns/promises` + `node:https` custom `lookup`/`servername`; transport injectable so tests need no network. Commit.

### Task 3: Action runner (arg validation, request build, response trimming, runs, pending)
**Depends on:** 1, 2. **Files:** `application/action-runner.ts`, `domain/build-request.ts`, `domain/trim-response.ts`, persistence for `action_runs` + `action_pending`, wire `test()` and `invoke()`.
- [ ] Failing tests: args validated against declared params (type coercion only string→number/boolean for numeric/boolean params; unknown keys dropped; required missing → `invalid_args`; strings ≤ 500); `path` values URL-encoded, no path traversal (`../`, `%2f` kept inert), `query` via URLSearchParams, header params limited to safe pattern and never `Host/Authorization/Cookie/Content-Length`; auth header from decrypted secret; write methods send `Idempotency-Key`; response trimmed to the declared fields of the matching status code (undeclared dropped, strings ≤ 500, arrays ≤ 10, depth ≤ 3); undeclared status → `bad_status`; `action_runs` row has no args/body; pending TTL 10 min, one per conversation (set replaces), expired → null; disabled action → `disabled`; action of another bot → `not_found`.
- [ ] Implement; commit.

### Task 4: AI pipeline integration
**Depends on:** 3. **Files:** `packages/ai-core/prompts/sales-agent@8.md`, `ai/domain/model-reply.ts`, `ai/application/playground.service.ts`, new `ai/application/action-loop.ts`, `decide-reply.ts`, `conversation` reply path if it needs the real conversation id; `PROMPT.version = 8` (+ tests/docs referencing @7); `ai/MODULE.md`.
- [ ] Failing tests (FakeLlmProvider scripted turns): (a) call_action GET → executes → second model turn answers using result figures (number grounding accepts figures from `<action_result>`); (b) requiresConfirm → pending stored, customer asked, next turn `confirm_action` executes the STORED args even if the model sends different ones; `cancel_action` clears; (c) pending expired/absent + `confirm_action` → no call, fallback; (d) 4th round → fallback `action_loop_limit`; (e) execution error is shown as `{ok:false,errorCode}` only; (f) injection text inside a result ("ignore previous instructions…") is inside `<action_result>` and never changes behaviour of guardrails; (g) unknown/disabled/foreign `actionId` → treated as `unknown`; (h) bot without actions → prompt has no `<actions>` block and behaviour identical to today (existing tests unchanged); (i) token usage summed over rounds, one ai_run.
- [ ] Implement; run the whole backend suite; commit.

### Task 5: Web UI
**Depends on:** 1 (contracts). **Files:** `apps/web/src/features/action/**` (api, hooks, components: list page, form with repeatable params/responses, test panel), route `apps/web/src/routes/app/bots/$botId/actions.tsx`, `training-nav.tsx` item + `Zap`-style icon, i18n vi/en, test-chat chip "action called" if the playground response exposes it (add `actions?: {name,ok,statusCode}[]` to `PlaygroundResponse` in contracts).
- [ ] Failing tests (vitest + RTL): form validation (name/description/url/method required, `{placeholder}`↔path-param match, duplicate param names), add/remove param & response rows, secret field write-only (shows "•••• đã lưu" when `hasSecret`), list search + status filter + enable toggle, empty state, test panel renders result/error.
- [ ] Implement matching the Bizfly screens (list: Tính năng/Trạng thái/Hành động; form fields per spec) in Rapiz orange, light theme; commit.

### Task 6: Docs, fake shop server, real-stack QA, independent review, acceptance
**Depends on:** 1–5.
- [ ] Docs: `docs/actions.md`, update `docs/06-ai-engine.md` §3.2, `docs/05-data-model.md`, `docs/09-security-and-compliance.md`, `MODULE.md`s; task file Plan/Log; `TODO.md` status.
- [ ] Fake shop API script in the scratchpad (orders GET, booking POST needing Idempotency-Key, `/slow`, `/redirect`, `/huge`, `/inject`) served on an allowed dev host; seed TinyMind actions; run scenarios from the spec §Quality gate 3 through the playground and (if tunnel up) the live Page.
- [ ] Independent review: fresh sonnet agent given only the diff + the checklist (SSRF, secrets, tenant isolation, injection, confirm bypass, idempotency, PII logs). Fix findings, re-run.
- [ ] `pnpm check` green; write acceptance report in the task Log (verified vs not verified); commit.

## Self-review

Spec coverage: placement (T5), methods + confirm (T3, T4), auth + secret handling (T1, T3), executor limits (T2, T3), pipeline loop (T4), API + UI (T1, T5), test panel (T1, T3, T5), QA/review/acceptance (every task's TDD + T6), docs (T6). Type names are the shared interfaces above.
