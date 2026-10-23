# ADR-001: TypeScript + NestJS modular monolith in a monorepo

- Status: Proposed · Date: 2026-10-23

## Context
The product has ~18 business modules and a team of 9–10 people; it needs to ship an MVP quickly but must be able to scale. Preny uses Next.js on the frontend; its backend is unknown.

## Decision
- One language (TypeScript) for FE/BE/worker/widget, pnpm + Turborepo monorepo.
- NestJS backend as a **modular monolith**; 3 separate processes from the start: `api`, `webhook`, `worker` (same codebase).
- ORM: Drizzle (preferred) or Prisma — finalized in Phase 0.

## Options considered
- Microservices from day one: high operational cost and distributed debugging, no load data yet → rejected.
- Go/Java backend: better performance but splits the stack from the FE, slows down the MVP.

## Consequences
- Module boundaries must be enforced (lint `no-restricted-imports`, domain events via outbox).
- Modules (e.g. `channel`, `ai`) can be split into separate services when needed without a rewrite.
