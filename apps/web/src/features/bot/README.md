# features/bot

Mirrors the backend `bot` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

## Business industry (T-093)

The bots route composes the current-workspace query into this feature through props. New bot creation shows the selected business industry as read-only and submits its exact supported Industry value; it never defaults an unread or unsupported business to retail. Loading, error/retry and unsupported legacy industry states block creation. Existing bots with a different historical industry are labelled without changing their training or hiding their existing controls. Business settings show the current business name/industry and explain that industry changes are unsupported. Account-level billing and shop models are separate pending work.
