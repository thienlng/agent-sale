# T-081 statistics implementation: independent QA

Date: 2026-10-27. Verdict: **approve the implemented increment**, subject to the author's final repository/CI gates. This is not acceptance of the pending shop aggregation or account ownership foundation.

The reviewer inherited the same model and reasoning effort as the implementing agent, with no model override. QA inspected the implementation independently and made no product-code edits. The review applied the repository `review-pr` checklist and the user-supplied UI/UX skill. The reviewed increment is in the `agent-sale-design` worktree; earlier lane B changes are its existing base.

## Scope and behavior reviewed

- Statistics is the selected-business default home and first sidebar entry. Explicit authentication return links remain supported.
- The current multichannel, Customers and Orders navigation remains intact. The logo opens a separate aggregate view and leaves the sidebar's selected business unchanged.
- Business selection lives only in the sidebar's anchored selector. The account retains its anchored dropdown and contains no business options.
- The existing twelve-metric statistics surface emphasizes four primary metrics, an area chart, compact dates and progressive filters/details. Definitions, unavailable/locked states, watermark-bound drilldowns and data freshness remain available.
- Portfolio reads use the real authorized workspace memberships and existing tenant-scoped analytics APIs. They do not temporarily mutate the active workspace or invent shop records.

## Security and context boundaries

The API client captures the tenant before the first asynchronous request and retains it through a token-refresh retry. Explicit portfolio tenant overrides are local to each request; normal requests keep the selected workspace. Added AbortSignal support propagates cancellation for portfolio work.

The selection helper rejects workspace IDs outside current memberships. The switching hook refuses concurrent switches and switches during active mutations, navigates away from resource-specific URLs before changing context, honors the existing unsaved-form blocker, checks that the session did not change during navigation, cancels/removes tenant queries and remounts route-local content under the new user/workspace key.

Portfolio queries are keyed by authenticated user, current memberships and date range. They evaluate analytics permission per membership, limit concurrency to three businesses, preserve own-customer visibility, and withhold a complete total when a tenant fails, is forbidden, has locked/missing metrics or uses an incompatible timezone. A failed tenant is not converted into zero. Existing backend membership and RLS enforcement remains authoritative.

No backend schema, billing ownership, new provider, dependency or unrelated module redesign is introduced by this increment.

## Findings resolved during implementation review

1. Portfolio custom dates initially lacked the existing range-validation gate. The current implementation uses `rangeProblem` to disable invalid requests and display a localized inline error; browser QA confirmed zero analytics fan-out for an invalid range.
2. The shared chart initially requested the selected business's channels even on the aggregate page. `usePages(enabled)` now avoids that unnecessary request when no page filter is shown.
3. Aggregate statistics initially omitted freshness information. The portfolio now discloses the oldest generated timestamp, timezone and maximum projection lag.
4. The own-customer description initially omitted unassigned customers. Both locales now describe the same assigned-plus-unassigned scope enforced by the backend.

Final screenshot review additionally found long KPI values escaping mobile cards and clipped Y-axis labels. Responsive container-relative value sizing retains the exact counts, and locale-aware compact axis ticks prevent clipping while full tooltips remain available. Both defects were fixed, visually inspected and verified with text-range geometry checks on the selected-business and portfolio pages at 375 pixels.

No unresolved correctness, visual or security blocker was found in the implemented increment. Existing tests were adapted to open the newly collapsed detail sections; their assertions were preserved rather than removed.

## Independent verification

Targeted Vitest: **4 files, 23 tests passed**:

```bash
pnpm --filter @agent-sales/web exec vitest run \
  src/lib/api-client.test.ts \
  src/lib/session.test.ts \
  src/features/analytics/api/portfolio.test.ts \
  src/features/analytics/components/statistics-page.test.tsx
# /tmp/qa-t081-unit.log
```

Eight additional independent Playwright scenarios passed against the actual development UI on port 5177, using existing synthetic fixtures and explicit two-business bootstrap responses:

- Authenticated root, real business statistics, changing selected business, retained drilldown behavior and no businesses in the account menu.
- Separate authorized tenant headers for portfolio reads, preserved active selection and navigation from the portfolio into a business.
- Invalid portfolio dates display validation without issuing analytics requests.
- Existing multichannel navigation and business selection remain usable at mobile width without horizontal overflow.
- Canceling the actual profile form's existing unsaved-edit blocker preserves its route, business and draft; proceeding switches to the target business statistics.
- A held profile-save mutation disables all business options and shows the pending-save explanation until the save completes.
- Desktop statistics, desktop portfolio, mobile statistics and mobile anchored account-menu screenshots were captured and inspected using synthetic data.
- Large exact KPI text ranges fit within all four cards, and every Y-axis tick fits within the SVG on both pages at 375 pixels.

Temporary harness and logs:

```bash
pnpm --filter @agent-sales/web exec playwright test \
  --config /tmp/qa-t081-actual/playwright.config.ts
# /tmp/qa-t081-actual.log: first four scenarios
# /tmp/qa-t081-blocker.log: unsaved-edit cancel/proceed
# /tmp/qa-t081-pending.log: pending mutation guard
# /tmp/qa-t081-captures.log: refreshed screenshot workflow
# /tmp/qa-t081-bounds-final.log: large-value/axis geometry regression
```

All requests in these browser cases were mocked. No live customer data was read or changed. Initial harness startup needed ESM configuration and an explicit Playwright module entry; those tooling attempts did not exercise or fail product behavior.

Final screenshots are available in `/tmp/qa-t081-actual/`: `business-desktop.png`, `portfolio-desktop.png`, `business-mobile.png` and `account-mobile.png`. The first geometry attempt used an obsolete Recharts ancestor selector; the corrected current tick-label selector passed without weakening the bounds assertions.

`git diff --check` passed at review time. Full `pnpm check`, broader responsive/smoke checks and CI remain the author's release gates; this report does not claim those results before they complete.

## Explicit remaining scope

Current persistence has neither first-class shops nor the proposed commercial account parent. The aggregate page therefore shows real authorized-business rows with an explicit unavailable-shop message. It does not label channels as shops or present synthetic shop statistics as live data. All-shop aggregation and final ownership mapping remain dependent on lane A (T-077/T-078/T-079/T-080); T-081 must retain that partial-completion qualification.


## Author release verification

- Full `pnpm check` passed: frontend 60 files / 377 tests; backend 63 files / 973 tests; build initial payload 224.7 KB gzip against the existing 250 KB budget.
- Production responsive gate: all six original tests passed, covering 28 routes at 375/768/1280/1920px and all layout preference combinations. Prior failures included local ENOSPC and concurrent rebuild contention; the clean rerun kept every assertion and timeout and disabled only trace recording.
- Three selected workflows passed against the actual serving checkout on port 5173, with mocked APIs. The development UI is updated without backend mutations or unrelated feature changes.
- PR #69 is stacked on PR #64. Parent T-081 remains in progress for real shop attribution; the implementation explicitly reports missing shop data.

## Main landing

The user explicitly requested merging the reviewed work. Parent PR #64 was squash-merged to main as 1b983a7. To avoid force-pushing the reviewed #69 branch after the resulting history conflict, the same three T-081 commits were cherry-picked onto the new main-based branch and opened as replacement PR #70. Before tracking edits, both trees were exactly d663ed3d725bda25b24db3a0f80d8c71394b6354. The app implementation remains unchanged; the replacement CI validates the clean history before merge.
