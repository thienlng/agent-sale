# Rule 04 — Code quality, tests and Definition of Done

## The gate

`pnpm check` = `lint` + `typecheck` + `test` + `build`. It must pass locally before you commit "done" and in CI before review. Never weaken the gate (disable a lint rule, add `// @ts-ignore`, skip/delete a test, lower coverage) to make it pass. If a rule is genuinely wrong, raise it with a human and fix it in a separate `chore` PR.

## TypeScript

- `strict: true` everywhere (see `tsconfig.base.json`). No `any` except at external boundaries (raw webhook payloads, third-party responses), and then parse immediately with Zod.
- Prefer explicit return types on exported functions. Prefer `unknown` over `any`. No non-null assertions (`!`) without a comment explaining why it is safe.
- Money and credits are integers (`bigint`/`number` of minor units). Floats for money are a lint error.

## Tests

- Every new behavior ships with tests in the same PR. Every bug fix starts with a failing test that reproduces it.
- Test pyramid (details in `docs/13-testing-and-quality.md`):
  - **Unit** (Vitest) for pure logic — billing, order math, state machines, parsers, normalizers. Target ≥ 80% line coverage in `packages/billing`, `packages/shared`, commerce domain logic.
  - **Integration** (Vitest + Testcontainers) for API + DB + queue, RLS/tenant isolation, idempotency.
  - **E2E** (Playwright) for P0 user flows; run on staging per release.
  - **AI evals** (`evals/`) whenever prompts, retrieval, tools or model maps change.
- Every new API endpoint gets: happy path, validation error, permission denied, and **cross-tenant access returns 404**.
- Tests are deterministic: no real network, no real time (`vi.useFakeTimers`), no shared mutable state between tests. Use factories from `packages/testing`.
- Name tests by behavior: `it('rejects an order whose total is negative')`.

## Style

- ESLint + Prettier are the style guide; do not argue with them in PRs. Run `pnpm format` before committing.
- Small functions, small files. A file over ~400 lines or a function over ~60 lines needs a justification in review.
- Match the surrounding code: naming, error handling, comment density. Do not reformat unrelated code.
- Comments explain *why*, not *what*. No commented-out code. No `console.log` in app code — use the logger.
- Input validation at the boundary (DTO / Zod). Domain logic framework-free so it is unit-testable.
- Errors: use the shared error codes in `packages/shared`; never swallow errors silently; never leak internals or PII in user-facing messages.

## Definition of Done (per feature)

1. The feature does what was asked, and each behavior is verifiable.
2. Tests added/updated; `pnpm check` green locally and in CI.
3. Permission + tenant isolation covered for any new endpoint or query.
4. Audit log / metrics / structured logs added for sensitive or operational actions.
5. i18n (vi + en) for any user-facing string; empty / loading / error states for UI.
6. Migrations are backward compatible (expand → migrate → contract); seeds updated.
7. Docs updated (`docs/`, ADR if architectural).
8. PR description says exactly how the change was verified (commands run, screenshots for UI).
