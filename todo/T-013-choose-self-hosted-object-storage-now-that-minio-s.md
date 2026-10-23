---
id: T-013
title: Choose self-hosted object storage now that MinIO stopped publishing community images
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: spike
priority: P1
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

ADR-006 lists MinIO for self-hosted S3-compatible storage. On 2026-10-23 `docker pull minio/minio` returned "pull access denied": MinIO no longer publishes community images. Media upload (bot albums, attachments, imports) needs object storage before M1's knowledge/media features.

## Goal

Pick the self-hosted S3-compatible store for local, CI and production, with a working compose service.

## Scope

- In scope: compare SeaweedFS, Garage, building MinIO from source/pinned old image, Ceph RGW (licence, S3 API coverage incl. presigned URLs and multipart, HA story, ops effort); add the chosen service to `infra/docker/docker-compose.local.yml`; update ADR-006 and `.env.example`.

## Out of scope

- …

## Acceptance criteria

- [ ] Decision recorded in ADR-006 with sources and date.
- [ ] Local compose starts it; a presigned PUT/GET round-trip test passes.

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-23 — created.

## Links

- Docs: …
- Related tasks: …
