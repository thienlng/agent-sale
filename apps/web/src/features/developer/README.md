# features/developer

Mirrors the backend `developer` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

- Settings → Developers (`/app/settings/developers`, ADR-022): API keys and webhook endpoints, owners and admins only (`developer.manage`). The route reads the plan's `feature.public_api` from billing and passes it as `apiEnabled`; without it nothing new can be created, existing keys and webhooks can still be revoked or removed.
- A full API key or webhook signing secret is returned once (create, rotate): it only lives in `SecretRevealDialog`'s props, and those mutations use `gcTime: 0` so the cache drops it at once.
- Copy is in the lazy `developer` i18n namespace (`loadNamespace('developer')` in the route loader).
