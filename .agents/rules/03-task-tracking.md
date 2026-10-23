# Rule 03 — Task tracking (`TODO.md` + `todo/`)

All work is tracked in the repository, not in chat. Two layers:

1. **`TODO.md`** (repo root) — the board. One line per task, grouped by status. Must stay short and scannable.
2. **`todo/T-<id>-<slug>.md`** — one file per task with the full description, plan, and log. Finished tasks move to `todo/done/`.

## Task IDs

- Format `T-<3+ digits>`: `T-001`, `T-002`, … Sequential, never reused. The next free ID is the highest existing ID + 1 (check both `todo/` and `todo/done/`).
- Sub-tasks: `T-012a`, `T-012b` (own file, referenced from the parent).
- Create with `pnpm todo:new "Title"` (runs `scripts/new-todo.sh`) — it allocates the ID, copies `todo/_template.md` and appends a line to `TODO.md` under **Backlog**.

## `TODO.md` format

```markdown
## In progress
- [ ] T-012 Contact import from CSV — @agent:claude · [details](todo/T-012-contact-import.md) · PR #34
## Next
- [ ] T-013 …
## Backlog
- [ ] T-020 …
## Blocked
- [ ] T-002 Finalize open decisions — @thienlng · blocked: needs human decision
## Done (last 10 — older ones live in todo/done/)
- [x] T-001 Repository foundation — PR #1
```

- Line format: `- [ ] T-<id> <Title> — @<owner> · [details](todo/<file>) · <PR link or blocker>`.
- Owner: a GitHub handle for humans, `@agent:<tool>` for agents.
- Keep at most 10 lines under **Done**; move older lines out (the file in `todo/done/` is the record).
- Order within a section = priority (top first). Humans set the order; agents do not reorder other tasks.

## Task file (`todo/_template.md`)

Front matter + sections: Context, Goal, Scope / Out of scope, Acceptance criteria, Plan, Log, Links. Fill the **Plan** section *before* writing code and keep the **Log** updated with dated entries (decisions, blockers, what was verified). The plan is what a human reviews first.

## Status lifecycle

`backlog → next → in-progress → (blocked) → review → done`

- `backlog`/`next`: humans decide priority. An agent may propose a new backlog task (with a file) when it discovers follow-up work, and must mention it in the PR.
- `in-progress`: set when you create the branch. Put your owner handle on the line. Work tasks of the same milestone one after another on the milestone branch; only one task is actively being coded at a time, the others of the block stay in **Next**.
- `blocked`: write the blocker in the file and on the board line; stop and report to a human.
- `review`: PR opened and ready. Add the PR number to the board line.
- `done`: set by the PR that finishes the task: in that same PR, move the file to `todo/done/`, set `status: done`, record the PR number, and move the board line to **Done**.

## Rules

- Never start code without a task file and a board line in **In progress**.
- Do not edit another owner's task file except to add a dated note in its Log.
- Do not delete task files; `done` or `cancelled` (with reason) only.
- Keep the board and the file consistent in every PR that touches the task.
- Task files are in English, concise, and link to the relevant `docs/` sections instead of repeating them.
