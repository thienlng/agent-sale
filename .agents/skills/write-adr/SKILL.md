---
name: write-adr
description: Write or update an Architecture Decision Record in docs/adr when a change adds/replaces core technology, changes module boundaries, tenant model, money/credit flow, runtime processes, or deviates from an existing ADR.
---

# Write an ADR

1. Confirm the human's request authorizes an architectural change (Rule 05). If not, stop and ask a human.
2. Copy `docs/adr/ADR-000-template.md` to `docs/adr/ADR-<next number>-<slug>.md` (next = highest existing + 1).
3. Fill: Status (`Proposed` until a human accepts it in review), Date, Deciders (human reviewers), **Context** (the problem and constraints, with links to docs/PRs), **Decision** (one paragraph, concrete), **Alternatives considered** (at least two, with why rejected), **Consequences** (positive, negative, follow-ups).
4. If it supersedes an older ADR, set the old one to `Superseded by ADR-<n>` and link both ways.
5. Add the row to `docs/adr/README.md`.
6. Reference the ADR in the PR summary. Update `docs/04-system-architecture.md` (or the relevant doc) to match.
