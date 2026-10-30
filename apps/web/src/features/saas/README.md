# features/saas

Mirrors the backend `saas` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

SaaS workspaces use `SaasRequestsPage` (`/app/saas-requests`), `SaasCustomersPage` (`/app/saas-customers`), `SubscriptionCard` (passed to the CRM contact sheet by the route through `renderOverviewExtra`) and `SaasInboxPanel` (composed in the Inbox sales panel). Revenue views check `contacts.view_all`. See [SaaS businesses](../../../../../docs/saas.md).
