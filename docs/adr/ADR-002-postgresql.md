# ADR-002: PostgreSQL (+pgvector) instead of MongoDB

- Status: Proposed · Date: 2026-10-23

## Context
Preny has publicly stated that it uses MongoDB. Our system has credit wallets, a ledger, orders, inventory, and campaigns that deduct money — requiring multi-table transactions, unique constraints (idempotency), and relational reporting. The AI needs vector search.

## Decision
Managed PostgreSQL 16, with extensions `pgvector`, `pg_trgm`, `unaccent`, `citext`, `pg_partman`. JSONB for flexible data (settings, channel payloads, custom fields).

## Consequences
- One DB for relational + vector + full-text → fewer components to operate.
- Large tables must be partitioned by month; when vectors exceed ~50 million chunks or queries become slow → consider a dedicated vector DB (Qdrant).
- Heavy analytics moves to ClickHouse at a later stage.
