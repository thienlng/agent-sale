# ADR-008: Immutable ledger, milli-credit unit

- Status: Proposed · Date: 2026-10-23

## Decision
1 credit = 1,000 VND (matching Preny's table: 110 VND = 0.11 credit). Stored as `bigint` milli-credit. Every balance change = 1 row in `ledger_entries` (unique idempotency_key) within the same transaction as the `wallets` update. Hold/capture/release for campaigns. Nightly reconciliation.

## Consequences
No double deduction on retry; balances are always traceable; top-up/usage history reports are queries on the ledger.
