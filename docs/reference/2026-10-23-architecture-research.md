# Repo architecture for agent-written code (NestJS/Fastify + Vite React + Drizzle + BullMQ, ~18 modules)

Research date: 2026-10-23. Sources are 2025–2026 unless noted. Secondary write-ups of the OpenAI post are flagged as such (the primary page returns 403 to fetchers).

## 1. Consensus (what nearly every 2025–26 source agrees on)

1. **Modules are the macro decision; internal style is micro.** A module = bounded context that owns its data and exposes a public API; how you organize *inside* (slices, pragmatic clean, hexagonal) is local and may differ per module. "The module's public API does that [protection]; slices inside don't need layers for protection" (Jovanović, [Where vertical slices fit inside the modular monolith](https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture)); same framing as "category error" in [modules vs vertical slices, 2026](https://appscale.blog/ja/blog/modules-vs-vertical-slices-macro-vs-micro-architecture-modular-monolith-2026).
2. **Rules without enforcement are suggestions.** Every agent-oriented source says the same: encode boundaries as lint/graph checks that fail CI and feed the error text back to the agent. OpenAI's harness post: "enforce invariants, not micromanage implementations… once encoded, they apply everywhere at once" (via [Emil Sit's summary](https://www.emilsit.net/t/2026/02/openai-harness-engineering/)); lint messages should "inject remediation instructions directly into agent context" ([engineering.fyi mirror](https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world)). Bitloops: "Rules without enforcement are suggestions" ([Architectural constraints for AI agents, Mar 2026](https://bitloops.com/resources/governance/architectural-constraints-for-ai-agents)). ThoughtWorks Radar (Apr 2026, *Assess*): "Increased use of AI coding agents can accelerate drift from the intended codebase and architecture designs"; pair deterministic tools (ArchUnit, Spring Modulith, Spectral) with LLM triage ([Architecture drift reduction with LLMs](https://www.thoughtworks.com/radar/techniques/architecture-drift-reduction-with-llms)).
3. **Small root instruction file + per-module docs.** OpenAI kept `AGENTS.md` to ~100 lines as "a map, not a 1,000-page instruction manual", with `docs/` as system of record. Anthropic: "For each line ask: would removing this cause Claude to make mistakes? If not, cut it"; put architectural decisions in CLAUDE.md, put sometimes-relevant knowledge in skills; make hooks (not prose) run lint ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)). Nested AGENTS.md: "place files at major module boundaries rather than too deep" ([AGENTS.md monorepo guide](https://www.mintlify.com/agentsmd/agents.md/guides/monorepos), [SSD Nodes](https://www.ssdnodes.com/learn/nested-agents-md-for-monorepos)).
4. **Deterministic scaffolding beats agent-improvised scaffolding.** Nx (Sep 2026): "Scaffolding is a deterministic operation, and I try to move that outside the model as much as I can… the combination is where the sweet spot is" ([Let AI agents extract reusable Nx generators](https://nx.dev/blog/agent-extract-nx-generator)); Turborepo `turbo gen` (Plop) for the same reason ([Turborepo generators](https://turbo.build/repo/docs/core-concepts/monorepos/code-generation), [Vercel Academy](https://vercel.com/academy/production-monorepos/turborepo-generators)).
5. **Give the agent a check it can run.** Anthropic: tests/build/lint "is the difference between a session you watch and one you walk away from"; Stop hooks as deterministic gates. OpenAI runs recurring "garbage collection" agents that scan for drift and open refactor PRs.
6. **Monorepo, pnpm workspaces, workspace references.** Splitting FE/BE repos forces agents to context-switch ([HackerNoon, Sep 2026](https://hackernoon.com/your-architecture-is-why-your-coding-agent-keeps-writing-bad-code); [Epsilla, Apr 2026](https://www.epsilla.com/blogs/repository-as-operating-system-agentic-harness-engineering)).

## 2. What agents get wrong (documented failure modes)

- **Anemic, framework-driven code**: "Agentic tools default to framework-driven development and anemic models, not DDD… scatter business logic across application layers, ignore architectural boundaries" (Jeremy Davis, Red Hat, [session 1](https://sessionize.com/s/jeremydavis/agentic-coding-intentional-design/160121), [session 2](https://sessionize.com/s/jeremydavis/domain-driven-design-is-your-agentic-coding-superp/191139)).
- **Layer violations and infra leaking into domain**: controller → DB directly; Stripe call inside an `Order` entity; one module reading another's tables ([Bitloops](https://bitloops.com/resources/software-architecture/how-ai-generated-code-impacts-architecture)).
- **Cycles from pattern-copying**: "Circular dependencies are almost always a sign of wrong abstraction" (Bitloops governance).
- **Duplication and wrong primitives**: re-implementing helpers, raw `fetch` instead of the API wrapper, new deps, inline CSS (HackerNoon). Root cause: "missing architectural context, not model quality".
- **Design-commitment drift across turns**: agents state a design then violate it later; a commitment ledger cut design-change rate from 6.9–10.6% to 1.6% ([NeurIPS 2026, "Do Coding Agents Keep Their Word?"](https://neurips.cc/virtual/2026/173024)).
- **Boundary erosion is silent**: "A module boundary is a guess, so treat it like one… if two things have to be correct at the same instant, they belong on the same side of the line… splitting a coarse module later is cheap, merging two is the expensive direction" (Jovanović, [The boundary I couldn't take back, Jun 2026](https://milanjovanovic.tech/blog/the-modular-monolith-boundary-i-couldnt-take-back)).

## 3. Contested points

| Topic | Position A | Position B | Our read |
|---|---|---|---|
| Full DDD 4-layer per module vs vertical slices | [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon) (14k stars): domain/application/infra/interface + CQRS per use case | Jovanović/Bogard: slices, add layers only where domain is rich; "the decision isn't about complexity" | Agents do better with **one fixed shape**; variance per module hurts them more than ceremony does. Pick a fixed, moderately layered slice shape (below). |
| Barrel `index.ts` public API | Nest docs: exported providers *are* the module's public interface ([NestJS modules](https://docs.nestjs.com/modules)); Jovanović: expose only what others need | bulletproof-react and Pocock: barrels hurt tree-shaking / hide deep modules; Pocock uses "root files = public, subfolders = private" ([setup-ts-deep-modules](https://www.typingmind.com/skills/mattpocock-setup-ts-deep-modules)) | Backend: one `api/` folder per module is the contract, enforced by dependency-cruiser. Frontend: no barrels, direct imports. |
| Enforcement tool | Nx `@nx/enforce-module-boundaries` (tag-based, needs Nx graph) ([Nx docs](https://nx.dev/packages/eslint-plugin/documents/enforce-module-boundaries)) | dependency-cruiser (works on resolved graph, catches cycles, `required`/`reachable` rules, tool-agnostic; Ghost moved to it when a custom ESLint rule missed ESM imports) ([rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)); eslint-plugin-boundaries (in-editor feedback, `default: disallow`) ([repo](https://github.com/javierbrea/eslint-plugin-boundaries)) | Use **both** dependency-cruiser (CI, cycles, graph) and eslint-plugin-boundaries (instant feedback in the agent's lint loop). Skip Nx unless you adopt Nx wholesale. |
| Frontend: FSD vs bulletproof-react | FSD gives strict layer rules + Steiger linter ([FSD overview](https://feature-sliced.design/docs/get-started/overview)) but "the hardest part is figuring out where one feature ends"; `shared/` becomes a dump ([FSD lessons, Nov 2025](https://dev.to/arjunsanthosh/mastering-feature-sliced-design-lessons-from-real-projects-2ida)) | bulletproof-react: `shared -> features -> app`, no cross-feature imports, ESLint `import/no-restricted-paths` ([project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)) | bulletproof-style feature folders keyed to backend module names + TanStack Router `-` colocation. FSD's 6 layers add decisions agents will make inconsistently. |
| Package-per-module vs folder-per-module | Packages give physical isolation + per-package AGENTS.md + `workspace:*` (HackerNoon) | Folders are cheaper; dependency-cruiser gives the same guarantees | Folder-per-module inside one `apps/api`; packages only for truly shared code. 18 packages for one Nest app is build/DI overhead with little gain. |
| Khononov coupling | `BALANCE = (STRENGTH XOR DISTANCE) OR NOT VOLATILITY` ([coupling.dev](https://coupling.dev/posts/core-concepts/balance/)): modules in one process are still "high distance", so model/intrusive coupling between them is unbalanced | — | Cross-module only via contract coupling (DTOs, events); never share Drizzle tables or entities. |

## 4. Recommended layout for this project

### 4.1 Monorepo

```
/
  AGENTS.md                    # ≤100 lines: map, commands, 10 invariants (CLAUDE.md -> @AGENTS.md)
  docs/
    ARCHITECTURE.md            # module list, allowed dependency graph, layer rules
    adr/0001-....md            # ADRs, one per decision; referenced from AGENTS.md
    TESTING.md
  apps/
    api/                       # NestJS on Fastify (modular monolith)
    web/                       # Vite React SPA
    worker/                    # same code as api, BullMQ processors only (thin entry)
  packages/
    contracts/                 # zod schemas + TS types per module; the ONLY thing web imports from api-land
    db/                        # drizzle schema split per module: schema/{identity,billing,...}.ts, migrations
    shared-kernel/             # Result, Money, TenantId, DomainEvent base, ids; no I/O
    ui/                        # shadcn-style primitives
    config-eslint/  config-ts/ # shared configs incl. boundaries rules
  tooling/
    generators/module/         # turbo gen "module" + "use-case" + "feature" templates
    .dependency-cruiser.cjs
  turbo.json  pnpm-workspace.yaml
```

### 4.2 Backend module skeleton (identical for all 18)

```
apps/api/src/modules/billing/
  MODULE.md                  # 30–60 lines: purpose, owned tables, public API, events in/out, invariants
  billing.module.ts          # Nest module; exports ONLY providers listed in api/
  api/                       # PUBLIC CONTRACT: the only folder other modules may import
    billing.facade.ts        # use-case-shaped interface (not CRUD), returns DTOs
    billing.events.ts        # integration events (versioned names: billing.invoice.paid.v1)
    billing.dto.ts
  domain/                    # pure TS, no Nest/Drizzle imports (enforced)
    invoice.aggregate.ts     # rich model, always-valid, invariants inside
    invoice.events.ts        # domain events
    billing.errors.ts
    ports/invoice.repository.ts
  application/
    commands/create-invoice/ create-invoice.command.ts | .handler.ts | .handler.spec.ts
    queries/get-invoice/
    event-handlers/on-subscription-renewed.handler.ts   # consumes other modules' events
    jobs/retry-charge.job.ts                             # BullMQ processors live here
  infrastructure/
    persistence/invoice.drizzle-repository.ts            # implements port; uses packages/db schema/billing
    stripe/stripe.client.ts
  interface/
    http/billing.controller.ts   # thin; validates via contracts, calls command/query handlers
  __tests__/                   # module-level integration tests + factories
    factories/invoice.factory.ts
    billing.facade.spec.ts     # contract test of the public API
```

Rules (mechanical): `domain` imports nothing but `shared-kernel`; `application` imports `domain` + ports; `infrastructure` imports both; `interface` imports `application` only; other modules import `modules/*/api/**` only; no cycles anywhere. Cross-module writes go through events via a transactional outbox (Drizzle, same transaction as the business row; in-process transport now, broker later; inbox with unique index for idempotency) — see [`@nest-native/messaging` write-up](https://dev.to/rodrigobnogueira/the-dual-write-problem-in-nestjs-solved-with-drizzle-a-transactional-outbox-idempotent-inbox-462l). Cross-module *reads* that need many modules (analytics, dashboards) get a dedicated read model fed by events, not facade chains ([internal vs public APIs](https://milanjovanovic.tech/blog/internal-vs-public-apis-in-modular-monoliths)). Tenancy: `TenantId` is a value object in shared-kernel; every repository method takes it; a dependency-cruiser `required` rule plus a custom ESLint rule flag any Drizzle query in `infrastructure/persistence` that lacks `tenantId`.

Suggested module layering for the allowed graph (lower may not import higher): `audit, notification` (leaf consumers via events) ← `identity, workspace` ← `billing, bot, knowledge, channel, ai` ← `conversation, crm, commerce, shipping, marketing, automation, support, affiliate` ← `analytics` (read-model only).

### 4.3 Frontend tree

```
apps/web/src/
  app/            # providers, router.tsx, route tree
  routes/         # TanStack file routes; (group) folders, _layout, "-components/" colocated non-route files
    _authed/billing/invoices.tsx   -> imports from features/billing
  features/<module>/   # mirrors backend module names
    api/            # TanStack Query hooks + client calls (use packages/contracts types)
    components/
    hooks/ stores/ types/
  components/ hooks/ lib/ stores/ types/ utils/   # shared; may not import features/ or app/
  testing/        # msw handlers, render helpers, factories
```

Rules: `shared -> features -> app/routes`; features never import each other (compose in routes); no barrels; one API client in `lib/api-client.ts` (raw `fetch` banned by lint). TanStack: "Files and folders with the `-` prefix are excluded from the route tree" ([file naming conventions](https://tanstack.com/router/latest/docs/framework/react/routing/file-naming-conventions)).

### 4.4 Enforcement stack (CI gates, all also run via `pnpm check`)

1. **dependency-cruiser** (`tooling/.dependency-cruiser.cjs`): `no-circular`; `module-public-api-only` (`from: modules/(X)/`, `to: modules/(?!$1)…` with `pathNot: /api/`); layer rules per module using `$1` back-references; `domain-is-pure` (`to.path: node_modules/(@nestjs|drizzle-orm|bullmq)` forbidden from `domain/`); `required` rule: every `*.controller.ts` reaches a `guards/tenant.guard`.
2. **eslint-plugin-boundaries** with the same element types for in-editor/agent-loop feedback; `import/no-restricted-paths` zones in web.
3. **tsc project references** per app/package with `strict`, `noUncheckedIndexedAccess`; `knip` for dead exports (unused `api/` exports = contract rot).
4. **Architecture tests** (ArchUnitTS or a small Vitest suite over `madge` output): "every module has MODULE.md, api/, billing.module.ts exports ⊆ api/" — ArchUnit-style fitness functions ([ArchUnitTS](https://dev.to/archunit/the-brutal-reality-of-software-architecture-5h03)).
5. **Custom ESLint rules with remediation text** (OpenAI pattern): file-size cap (~400 lines, kills god services), `*.handler.ts` must export one class with `execute`, no `console.log`, tenantId presence.
6. **Claude Code hooks**: PostToolUse → `eslint --fix` on edited file; Stop hook → `pnpm check` must pass.
7. **Doc-gardening job** (weekly `claude -p`/Codex): diff `MODULE.md` against `api/` and events; open PR.

### 4.5 Generators and docs

- `pnpm gen:module <name>` scaffolds the full tree above plus `MODULE.md`, `schema/<name>.ts`, a contract test and an entry in `docs/ARCHITECTURE.md`'s graph; `pnpm gen:use-case <module> <name>` and `pnpm gen:feature <module>` for FE. Keep one **golden module** (`modules/workspace`) fully fleshed out and name it in AGENTS.md as "copy this pattern" (Anthropic: "reference existing patterns… HotDogWidget.php is a good example").
- `MODULE.md` template: Purpose · Owned tables · Public API (facade methods, DTOs) · Events published/consumed · Invariants · Do-not (e.g. "never import `conversation/infrastructure`") · Test command.
- ADRs in `docs/adr/`, linked from the modules they constrain; `AGENTS.md` lists the invariants (10 max) and points to `docs/ARCHITECTURE.md`.

### 4.6 Tests

- Unit tests **co-located** (`*.spec.ts` next to handler/aggregate) — Vitest default, most TS monorepos ([Vitest guide](https://cn.vitest.dev/guide/learn/writing-tests)); integration tests per module in `__tests__/` with Testcontainers Postgres; `e2e/` at app root for HTTP flows.
- Factories per module (`__tests__/factories`, Fishery-style) exported only for tests; tenant-scoped by default.
- **Contract tests**: each module's `api/*.facade.spec.ts` exercises the facade and asserts event payloads against `packages/contracts` zod schemas; consumers test against the same schemas (in-process, no Pact needed yet).

## 5. Open questions to decide before scaffolding

1. Commands/queries as separate folders (CQRS-lite, above) vs one `use-cases/` folder — pick one and encode in the generator.
2. Whether `analytics` reads other modules' tables directly (fast) or only via event-fed read models (clean). Jovanović: let "consistency requirements decide where the line goes."
3. Worker deployment: same image with `WORKER=1` vs separate app — affects where `jobs/` live (recommend inside module `application/jobs`, registered by the worker entry).
