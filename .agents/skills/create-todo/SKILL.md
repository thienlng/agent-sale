---
name: create-todo
description: Create a well-formed task (T-xxx file + TODO.md line) for new work, follow-ups found during a task, or bugs. Use instead of fixing out-of-scope things or keeping work only in chat.
---

# Create a task

1. Check it does not already exist: `rg -i "<keyword>" TODO.md todo/`.
2. Run `pnpm todo:new "<Title in imperative English>"`. The script allocates the next `T-<id>`, creates `todo/T-<id>-<slug>.md` from `todo/_template.md`, and appends a line under **Backlog** in `TODO.md`.
3. Open the new file and fill:
   - `type`: feature | bug | chore | spike | docs; `priority`: P0–P3 (match `docs/02-functional-requirements.md` where applicable); `feature_ids` (e.g. `BOT-07`).
   - **Context** — why this exists (link the PR/review/doc where it came from).
   - **Goal** — one sentence.
   - **Scope / Out of scope** — explicit.
   - **Acceptance criteria** — verifiable checkboxes.
   - **Links** — docs sections, related tasks, external references with dates.
4. Leave **Plan** and **Log** empty unless you already know the plan.
5. Do not reorder other backlog items; a human prioritizes. If it is urgent (blocks you, security), say so in the PR/chat.
6. Commit it with the current work (`chore(todo): add T-<id> <title>`) or, if standalone, on a short `chore/T-<id>-…` branch.
