---
id: T-008
title: Add deploy workflows (dev/staging) and environment docs
status: backlog
type: chore
priority: P1
owner:
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:
---

## Context

CI currently only validates PRs. `docs/10-operations-and-deployment.md` describes dev/staging/production environments and a GitOps-style pipeline. Depends on T-002 (hosting decision) and on at least one deployable app (T-003).

## Goal

Merging to `main` deploys `api` and `web` to the `dev` environment; tagging a release deploys to `staging` after e2e smoke tests; production requires manual approval.

## Scope

- Dockerfiles per app (`infra/docker/`), image build + push on CI with SBOM and Trivy scan.
- `.github/workflows/deploy-dev.yml`, `deploy-staging.yml` using GitHub Environments and secrets.
- `docs/runbooks/deploy.md` and rollback procedure.

## Out of scope

- Kubernetes/Helm (phase 2 per docs).

## Acceptance criteria

- [ ] Merge to `main` results in a reachable dev URL for `GET /api/v1/health`.
- [ ] Rollback procedure tested once and documented.

## Plan

## Log

- 2026-10-23 — created; depends on T-002, T-003.

## Links

- Docs: `docs/10-operations-and-deployment.md`
