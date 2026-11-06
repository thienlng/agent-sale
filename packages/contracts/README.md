# @agent-sales/contracts

Zod schemas + inferred types for everything that crosses a process or module boundary: HTTP request/response DTOs, integration events, error envelope, pagination. One folder per backend module (`src/<module>/`), re-exported from `src/index.ts`.

- Backend controllers validate requests with these schemas; facades return these DTOs.
- The web app imports **only** this package (plus `shared`, `ui`, `i18n`) from backend-land.
- Integration events are versioned (`<module>.<thing>.<verb>.v1`); never change a published version — add `v2`.
- OpenAPI is generated from these schemas (`z.toJSONSchema`) by the backend (T-003).

## Declaring a route for the owner assistant (T-170)

Every workspace-scoped route in a `<module>.routes.ts` must carry `assistant` (`RouteAssistantUse` in `src/common/routes.ts`); `src/common/routes.assistant.test.ts` fails without it.

```ts
{
  method: 'get',
  path: '/orders',
  summary: 'List orders',
  // …
  assistant: { use: 'read', when: 'Find orders by status, customer or date, with totals.' },
}
```

- `use: 'read'`: the assistant may call it as a tool. Only a GET, or a POST that only queries (search, statistics, quotes) flagged `queryPost: true`.
- `use: 'write'`: the assistant may only propose it; it runs when the owner approves the card. Never a GET.
- `use: 'never'`: not a tool. Use it for auth, sessions, members and roles, billing payment, channel OAuth, secrets and credentials, uploads, deletions of accounts or businesses, messages to customers, the assistant's own routes, and whenever unsure.
- `when` is required for `read` and `write`: English, at most 160 chars, saying when the model should use the route. `tool_search` matches English words of the key, `summary` and `when`, so write it in the words an owner's question maps to.
- A route that is not workspace-scoped may only be `never` (or have no `assistant` field).

### A `write` whose body can carry a secret (T-174)

A body property named like `secret`, `password`, `token`, `api_key`/`apikey` or `credential` makes a route `never`, unless it declares a narrower body for the assistant:

```ts
assistant: {
  use: 'write',
  when: 'Draft a new API action for a bot …; it is created disabled and without its secret.',
  body: ActionAssistantDraft, // ActionBase.omit({ authSecret: true }).extend({ enabled: z.literal(false) }).strict()
},
```

The assistant validates `tool_call` against `assistant.body`, `tool_describe` shows it, and approval re-checks the stored body with it; the route itself still validates its full `body` when the proposal runs. `routes.assistant.test.ts` reads every `write` body's top-level properties: a secret-like one needs `assistant.body`, a valid sample in `VALID_ASSISTANT_BODIES`, and the narrowed body must reject the sample with each secret key added (use `.strict()` so the key is refused, not stripped). A narrower body can also just keep `tool_describe` small: the product writes use `AssistantUpsertProductRequest`, whose accommodation leaves out the fields only the lodging bot product fills (media folders, unit details, bedroom packages), which a catalog product never stores (T-193).

Test: `pnpm --filter @agent-sales/contracts test`.
