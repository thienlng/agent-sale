# ADR-004: Multi-tenant shared schema + Row-Level Security

- Status: Proposed · Date: 2026-10-23

## Decision
Every business table has `workspace_id`; the app sets `app.workspace_id` in every transaction; RLS policies on every table; the app's DB role does not have BYPASSRLS. Membership is checked in the API guard (client headers are not trusted).

## Consequences
A double layer of defense against cross-tenant data leaks. Jobs/workers must set the context. Large tenants can later be moved to a dedicated DB (routing by workspace).
