# T-093 selected-business industry increment

Date: 2026-10-28. Implemented on `feat/tung-dev` as independent lane B work.

## Behavior

New bots inherit the industry of the currently selected business. The creation dialog shows that industry read-only instead of asking again; the user only supplies the bot name. It waits for business context, supports retry after an error and blocks unsupported legacy business values with an explanation. It never chooses a retail/generic fallback.

The server reads the selected workspace through `WorkspaceFacade.getById`, validates its industry against the existing `Industry` contract and rejects a contradictory requested pack before creating a bot or seeding knowledge. No new endpoint, field or ownership model is introduced.

Business profile settings show the current business name and read-only industry, with explicit guidance that industry changes are unsupported. Existing profile copy keeps business details separate from login and billing information. The surrounding Settings heading stays neutral because its existing Security tab is account-scoped.

Existing bots with a different historical industry remain readable and editable; the bot list explains the mismatch without migrating their training or removing their controls. Bot updates do not change industry under the existing contract.

## Scope and query isolation

The bots route composes the workspace feature query into bot components through props. Bot features do not import workspace features. `useCurrentWorkspace` binds the workspace key to the actual request header and forwards the query's cancellation signal. Delayed retries cannot read a different selected business into the original cache key.

Bot-to-workspace reads use the existing public facade and allowed module dependency; no repository/table access crosses module boundaries. No schema, migration, provider, dependency or ADR change is required.

## Verification

- Failing-first policy regressions: mismatched and unsupported industry requests initially succeeded; captured-scope retry initially followed global selection; creation UI initially offered a retail picker.
- Backend focused HTTP: 31/31 across the industry policy and existing HTTP suite. Covers matching pack, contradiction with zero writes, unsupported legacy values, foreign workspace denial and ordinary edits of historical mismatched bots.
- Frontend focused: 15/15 across four files. Covers fixed/default industry, a business change, loading/error/retry/unsupported states, legacy warnings and controls, read-only business settings switching, immutable retry scope and forwarding cancellation.
- Synthetic fixtures in existing HTTP/AI/team tests are aligned with their workspace industry. Assertions are preserved.
- Additional real Postgres regression: 3 files / 15 tests passed across bot, AI and team integration suites (`/tmp/t093-integration.log`).
- Parent full gate passed: backend 1,104 tests, frontend 499 tests, initial bundle 232.2 KB gzip below 250 KB. Fresh same-model QA approved source and scoped retry behavior. Browser acceptance is recorded in the final lane B closeout.
- Two older bot delete/history suites now create real workspaces before creating bots; all 7 existing assertions/tests pass without bypassing the new policy.

## Still dependent on lane A

Account-level packages, shared message allowance and account billing permissions are T-092/T-091 work. This increment does not aggregate workspace allowances or present workspace entitlements as account usage. The original combined billing acceptance remains open. Shop-specific settings/statistics require the approved shop model; vertical operational engines remain outside this task.
