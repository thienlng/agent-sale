---
name: start-task
description: Take a task from TODO.md through branch creation, planning, implementation and verification, ending ready for the open-pr skill. Use whenever you begin work on a T-xxx task.
---

# Start a task

Prerequisite: onboarding done this session; working tree clean on `main`.

## 1. Claim

- Pick the task: the one assigned by a human, else the top item in **Next** in `TODO.md`.
- `git switch main && git pull --ff-only`.
- Create the branch: `git switch -c <type>/T-<id>-<slug>` (Rule 02).
- In `TODO.md`: move the line to **In progress**, set owner `@agent:<tool>`. In the task file: `status: in-progress`, `owner`, `branch`.
- Commit: `chore(repo): start T-<id>` with `Refs: T-<id>`.

## 2. Understand

- Read the task file and every linked doc/section. List the acceptance criteria; if any is not verifiable, rewrite it as verifiable and note it in the Log.
- Explore the code you will touch (`rg`, read files). Identify the module boundary, existing patterns, existing tests.
- Questions that change what gets built → write them in the Log and ask the human now. Do not proceed on guesses.

## 3. Plan (written, before code)

Fill the task file **Plan** section:
- Steps in order, each small enough to commit on its own.
- Files/modules to add or change.
- Tests to write (unit / integration / e2e / eval) and the cross-tenant case if there is a new endpoint.
- Migration / docs / i18n impact.
- Risks and how you will verify.

For tasks estimated over a day: push the branch, open a **draft PR** containing only the plan, and wait for a human comment.

## 4. Implement

Follow the plan step by step. For each step: write the failing test → implement → run the targeted tests → commit (Conventional Commits, `Refs: T-<id>`). Keep the Log updated with decisions and surprises. Stay in scope (Rule 08).

## 5. Verify

- `pnpm check` must pass. Run the e2e/evals if your change touches their scope.
- Manually exercise the change where it makes sense (API call, UI screenshot) and record how in the Log.
- Re-read the acceptance criteria one by one and tick them in the task file.
- Update `docs/` for any behavior/API/schema/config change.

## 6. Hand over

Run the `open-pr` skill.
