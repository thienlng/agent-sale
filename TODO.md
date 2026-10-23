# TODO — task board

Rules: `.agents/rules/03-task-tracking.md`. One line per task; details in `todo/`. Create tasks with `pnpm todo:new "Title"`. Order within a section = priority. Humans reorder; agents only move their own task between sections.

## In progress

Milestone **M1-foundation** — branch `feat/T-004-m1-foundation`, one PR for T-004, T-003, T-014.

- [ ] T-003 Complete the backend runtime: OpenAPI, request tracing, readiness, auth placeholder — @agent:claude · [details](todo/T-003-scaffold-api.md)

## Next

- [ ] T-014 Authentication and workspace onboarding: signup, login, refresh rotation, membership guard, bootstrap — @agent:claude · [details](todo/T-014-authentication-and-workspace-onboarding-signup-log.md)
- [ ] T-005 Complete the web shell: auth pages, layout, size and Lighthouse CI — @unassigned · [details](todo/T-005-scaffold-web.md)

## Backlog

- [ ] T-013 Choose self-hosted object storage now that MinIO stopped publishing community images — @unassigned · [details](todo/T-013-choose-self-hosted-object-storage-now-that-minio-s.md)
- [ ] T-006 Add Testcontainers integration test harness and cross-tenant test helper — @unassigned · [details](todo/T-006-integration-test-harness.md)
- [ ] T-007 Add packages/ai-core LLM gateway skeleton with eval runner — @unassigned · [details](todo/T-007-ai-core-skeleton.md)
- [ ] T-008 Add deploy workflows (dev/staging) and environment docs — @unassigned · [details](todo/T-008-deploy-workflows.md)
- [ ] T-011 Add Claude Code hooks: eslint --fix after edits and pnpm check on stop — @unassigned · [details](todo/T-011-add-claude-code-hooks-eslint-fix-after-edits-and-p.md)

## Blocked

- [ ] T-002 Finalize open decisions (domain, data-center location, MVP channels) — @thienlng · blocked: human decision · [details](todo/T-002-finalize-open-decisions.md)

## Done (last 10 — older ones live in todo/done/)

- [x] T-004 Wire the database: local infra, migration runner, RLS integration tests, Drizzle repositories — @agent:claude · [details](todo/done/T-004-packages-db.md) · M1-foundation PR
- [x] T-012 Record brand Razpi, white-orange theme and single maintainer — @agent:claude · [details](todo/done/T-012-record-brand-razpi-white-orange-theme-and-single-m.md)
- [x] T-010 Scaffold codebase skeleton and architecture conventions — @agent:claude · [details](todo/done/T-010-scaffold-codebase-skeleton-and-architecture-conven.md) · PR #10 (squashed into #9)
- [x] T-009 Decide performance-oriented tech stack (ADR-009) — @agent:claude · [details](todo/done/T-009-decide-performance-oriented-tech-stack-adr-009.md) · PR #9
- [x] T-001 Repository foundation: agent rules, skills, tooling, CI — initial commit
