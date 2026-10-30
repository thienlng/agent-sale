# features/commerce

Mirrors the backend `commerce` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.


Hotel workspaces use `AccommodationList`/`AccommodationForm` and `StayRequestsPage`/`StayRequestForm`, with captured-workspace API hooks in `api/lodging.ts`. Their navigation and Inbox stay CTA are composed at app routes; shared layout components receive the industry as a prop. Reference quotes are never physical availability guarantees, and staff confirmation requires both attestations plus an agreed total. See [lodging operations](../../../../../docs/lodging.md).
