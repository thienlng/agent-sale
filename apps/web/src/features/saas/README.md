# features/saas

Mirrors the backend `saas` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

A SaaS business has no pages of its own: its leads and subscribers live on the customer list (ADR-014). The `/app/contacts` route composes `SaasSummaryStrip` (MRR, customers per stage, trials ending soon), `useSubscriptionColumns` (plan, MRR, next date per row) and `SubscriptionCard` (customer sheet, also in the Inbox sales panel). Revenue views check `contacts.view_all`. See [SaaS businesses](../../../../../docs/saas.md).
