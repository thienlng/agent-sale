# Rule 06 — Documentation

- `docs/` is the design baseline (English). It is updated **in the same PR** as the change it describes. A PR that changes behavior, API, schema, config, env vars, queues, or infrastructure without a docs update is incomplete.
- Structure: numbered design docs (`docs/01-…` to `docs/14-…`), `docs/adr/` for decisions, `docs/reference/` for research and external specs, `docs/runbooks/` for operations (create when the first runbook exists), `docs/integrations/<provider>.md` for each third-party connector (API version, scopes, limits, date last verified).
- Each app/package has a `README.md` stating purpose, how to run, how to test, and key env vars. Keep it current.
- Write for a competent engineer who has never seen the project: lead with purpose, then how, then details. Prefer tables and short lists. Keep diagrams in Mermaid inside markdown.
- Do not duplicate: link to the canonical section instead of restating it. Rules live in `.agents/rules/`, design in `docs/`.
- Mark uncertainty explicitly ("not verified", "assumption"). Record the date when citing external pricing, API limits or policies.
- Every external claim about a third-party API (Meta, Zalo, carriers, payment providers) must link to the official doc and state the date checked.
- Do not edit `docs/reference/preny-dashboard-spec.md` except to fix factual errors; it is research evidence.
- OpenAPI is generated from code; do not hand-edit generated specs.
