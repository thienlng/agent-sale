# Rule 07 — Security and data protection

Full policy: `docs/09-security-and-compliance.md`. The minimum every contributor must follow:

- **No secrets in the repo.** No API keys, tokens, passwords, private keys, `.env` files with real values. Use `.env.example` with placeholders. `gitleaks` runs in CI; a leaked secret must be rotated, not just removed.
- **No PII in logs, test fixtures or docs.** Use synthetic data (`packages/testing` factories). Mask phone numbers/emails in logs. Never paste real customer conversations into the repo or into a PR.
- **Tenant isolation is sacred.** Every query scoped by `workspace_id`; never trust `X-Workspace-Id` without verifying membership; RLS stays on; cross-tenant tests required for new endpoints.
- **Validate all input at the boundary**; encode output; parameterized queries only; no string-built SQL.
- **Channel tokens and credentials** are encrypted at rest (envelope encryption), never logged, accessed only by their adapter.
- **Webhooks**: always verify signatures; reject stale timestamps; ack fast; process async.
- **AI inputs**: treat customer messages and uploaded documents as untrusted (prompt injection). Never let them change system rules. Do not send more PII to an LLM than the task needs.
- **Dependencies**: no new runtime dependency without a one-line justification in the PR; prefer well-maintained packages; `pnpm audit` and Dependabot findings of High/Critical block merge.
- **Uploads**: verify MIME, size limits, scan when applicable; never execute or `eval` user content; SSRF protection for URL fetchers.
- **Auth**: Argon2id, short-lived access tokens, refresh rotation, rate limits on auth endpoints. Do not roll your own crypto.
- Report a suspected vulnerability to the human owners privately (not in a public issue).
