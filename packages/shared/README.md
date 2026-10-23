# @agent-sales/shared

Pure, framework-free code shared by every app and package: domain types, Zod schemas, error codes, enums, and small utilities (money, phone, dates). No I/O, no framework imports.

- Run tests: `pnpm --filter @agent-sales/shared test`
- Build: `pnpm --filter @agent-sales/shared build` (emits `dist/`)

Rules of this package:

- Everything here must be unit-testable and deterministic.
- Money is integer VND; credits are integer milli-credits (`money.ts`, ADR-008).
- Phone numbers are stored in E.164 (`phone.ts`).
- Add error codes to `errors.ts` (to be created with the first API) and never duplicate them in apps.
