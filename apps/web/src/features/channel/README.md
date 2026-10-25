# features/channel

Mirrors the backend `channel` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.


T-069 adds a Facebook posts/comments panel on the workspace Channels screen, with independent public/private/keyword-moderation controls, saved post exclusions and staff hide/unhide/reply actions. Bot-bound integration screens keep their existing connection controls. See [behavior and limits](../../../../../docs/integrations/facebook-comments.md).
