# features/notification

Mirrors the backend `notification` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

The header bell (`components/notification-bell.tsx`) is eager and small; its list and the `notification` namespace load on the first open. A report notification asks the owner assistant to open through `requestAssistantOpen` in `@/lib/assistant-context`.
