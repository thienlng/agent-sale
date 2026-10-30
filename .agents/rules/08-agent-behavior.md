# Rule 08 — How agents work here

## Start

1. Run the `onboarding` skill on your first session (reads the mandatory files, verifies the environment).
2. Work on what the human asked for. If the request is ambiguous, ask **before** coding. Do not guess on product behavior, pricing, security or architecture.
3. For larger features, state a short plan (steps, files, tests, risks) to the human first.

## While working

- **Stay in scope.** Do what was asked. Found something else broken? Mention it to the human or in the PR; fix it in the same branch only if it belongs to the feature or blocks you.
- **Small steps, frequent verification.** Run the relevant tests after each meaningful change; run `pnpm check` before every push.
- **Protected files** — `AGENTS.md`, `.agents/**`, `.github/**`, `CODEOWNERS`, root tooling config (`package.json` scripts, `turbo.json`, `tsconfig.base.json`, ESLint/Prettier/commitlint config), `docs/adr/**`: change them only when a human explicitly asks.
- **Never**: delete/skip tests to go green, bypass git hooks, force-push shared branches, commit secrets, change dependencies' major versions casually, run destructive commands against any shared database, call paid external APIs from tests.
- **Dependencies**: adding one requires a reason in the PR. Prefer what the repo already uses.

## Finish

- Verify before claiming: put the commands you ran and their results in the PR (`pnpm check` summary, test counts, screenshots for UI). "Should work" is not done.
- Open the PR only when the feature is complete (Rule 02); use the `open-pr` skill.
- Before merging, update the branch with `main` and resolve conflicts (Rule 02).
- Reply to every review comment. If you disagree, explain with evidence.

## Communication

- Be concise and factual. Report failures as failures. State assumptions explicitly.
- Chat with humans in their language; everything written into the repo in English (Rule 01).
- When blocked for more than a short investigation, stop and report instead of trying workarounds that widen scope.
