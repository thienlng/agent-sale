# @agent-sales/contracts

Zod schemas + inferred types for everything that crosses a process or module boundary: HTTP request/response DTOs, integration events, error envelope, pagination. One folder per backend module (`src/<module>/`), re-exported from `src/index.ts`.

- Backend controllers validate requests with these schemas; facades return these DTOs.
- The web app imports **only** this package (plus `shared`, `ui`, `i18n`) from backend-land.
- Integration events are versioned (`<module>.<thing>.<verb>.v1`); never change a published version — add `v2`.
- OpenAPI is generated from these schemas (`z.toJSONSchema`) by the backend (T-003).

Test: `pnpm --filter @agent-sales/contracts test`.
