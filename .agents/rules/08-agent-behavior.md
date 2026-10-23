# Rule 08 — How agents work here

## Start

1. Run the `onboarding` skill on your first session (reads the mandatory files, verifies the environment).
2. Take exactly one task from `TODO.md` (**Next** section, top first, unless a human assigned you one). Use the `start-task` skill.
3. Read the task file and every doc it links. If the task is ambiguous, write your questions in the task file's Log and ask the human **before** coding. Do not guess on product behavior, pricing, security or architecture.
4. Write the **Plan** section in the task file first (steps, files to touch, tests to add, risks). For tasks over ~1 day, open a draft PR containing only the plan and wait for a human comment before implementing.

## While working

- **Stay in scope.** Do only what the task says. Found something else broken or missing? Create a backlog task (`pnpm todo:new`) and mention it in the PR; do not fix it in this PR unless it blocks you.
- **Small steps, frequent verification.** Run the relevant tests after each meaningful change; run `pnpm check` before every push.
- **Do not touch protected files** without a task that explicitly covers them: `AGENTS.md`, `.agents/**`, `.github/**`, `CODEOWNERS`, root tooling config (`package.json` scripts, `turbo.json`, `tsconfig.base.json`, ESLint/Prettier/commitlint config), `docs/adr/**`, migrations of other tasks. If you need a change there, say so in the PR and let a human do it or approve it.
- **Never**: delete/skip tests to go green, bypass git hooks, force-push shared branches, commit secrets, change dependencies' major versions casually, run destructive commands against any shared database, call paid external APIs from tests.
- **Dependencies**: adding one requires a reason in the PR. Prefer what the repo already uses.
- Keep the task file Log updated with dated entries: decisions, blockers, what you verified.

## Finish

- Verify before claiming: paste the actual commands you ran and their results in the PR (`pnpm check` output summary, test counts, screenshots for UI). "Should work" is not done.
- Use the `open-pr` skill. Fill the template completely. Reference the task ID. Update `TODO.md` and the task file in the same PR.
- Reply to every review comment. If you disagree, explain with evidence; do not silently comply or silently ignore.
- Continue with the next task of the same milestone on the same branch (Rule 02). After the milestone PR is merged, start the next milestone from a fresh branch off `main`.

## Communication

- Be concise and factual. Report failures as failures. State assumptions explicitly.
- Chat with humans in their language; everything written into the repo in English (Rule 01).
- When blocked for more than a short investigation, stop and report instead of trying workarounds that widen scope.
