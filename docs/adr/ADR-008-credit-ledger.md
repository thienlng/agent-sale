# ADR-008: Immutable ledger, milli-credit unit

- Status: Proposed · Date: 2026-10-23

## Decision
1 credit = 1,000 VND (matching Preny's table: 110 VND = 0.11 credit). Stored as `bigint` milli-credit. Every balance change = 1 row in `ledger_entries` (unique idempotency_key) within the same transaction as the `wallets` update. Hold/capture/release for campaigns. Nightly reconciliation.

Constraints added after review (2026-10-23): `ledger_entries` is **never partitioned** (a partitioned table cannot carry a global `UNIQUE(idempotency_key)`, which is the whole guarantee); it is append-only with `(wallet_id, created_at)` and `(idempotency_key)` indexes and is archived by copying to object storage, not by dropping partitions. The debit is a **separate short transaction** executed before/after the LLM call, never inside it, so the wallet row lock is held for milliseconds and a bursting tenant does not serialize on it.

## Consequences
No double deduction on retry; balances are always traceable; top-up/usage history reports are queries on the ledger.
