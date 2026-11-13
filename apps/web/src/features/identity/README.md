# features/identity

Mirrors the backend `identity` module. `api/` = TanStack Query hooks calling `@/lib/api-client` with types from `@agent-sales/contracts`; `components/` = feature UI; `hooks/` = feature logic. Never import another feature; compose in `routes/`.

Account security (`components/security-page.tsx`): two-step verification and linked sign-ins (`linked-sign-ins.tsx`). Users without a password skip the password field; the server asks for a step-up instead. The step-up prompt itself is shared (`components/step-up-dialog.tsx`, mounted in `routes/__root.tsx`): the API client opens it on 403 `reauth_required` or `mfa_session_required` and sends the request again once the user has confirmed (docs/09 §2). `/login?google=verify` asks for the code emailed to finish a Google sign-up on an address Google does not own.
