# T-081 overview prototype: independent QA review

Date: 2026-10-27. Verdict: **approved for product design review**.

The reviewer was spawned with full-history inheritance and no model override, so it uses the same model and reasoning effort as the implementing agent. This is a design/prototype review, not acceptance of production business aggregation or backend changes.

## Current-product evidence

Reviewed the actual serving checkout at `../agent-sale-main`: global shell and user-controlled sidebar; bot training navigation and test dock; the existing sales inbox list/thread/customer panel; statistics cards, filters, chart, breakdowns and drilldown sheet. Compared the prototype with authenticated application screenshots populated through existing synthetic API fixtures. No live customer records were accessed or modified.

The proposal retains the Rapiz shell, existing font declaration and semantic color direction. It removes the single-child multichannel wrapper, makes Customers and Orders directly reachable while preserving their subordinate pages, and reduces the statistics landing view from twelve prominent cards plus a large filter block to four primary metrics with progressive detail. Logo navigation opens all-business statistics while the working business stays explicit. Selecting a visible business updates the same statistics view immediately.

Current analytics contracts apply source/Sales filters to customer metrics, Sales to tag/status metrics, and page filters to conversation metrics. The prototype identifies these scopes instead of pretending that every filter applies to all statistics. Cross-business aggregation and shop attribution remain proposed integrations dependent on lane A.

## Findings resolved before approval

- An author CSS `display:flex` rule overrode the hidden page filter in global scope.
- Collapsed navigation lost accessible names, and carrying the collapsed state into mobile hid drawer labels.
- The mobile drawer allowed keyboard focus to escape into background content.
- Initial draft omitted custom dates and access to existing source/Sales filters.
- Conversation detail metrics were misleadingly grouped under a tags/status heading.
- Approximate chart aggregation did not reconcile with displayed totals over all supported periods.
- Custom one-day page rows displayed fractional conversation counts.
- Scaling a fixed SVG viewBox made mobile chart labels unreadably small.
- A redundant quick-access panel repeated already-direct sidebar destinations.

These issues were corrected and rechecked. No unresolved blocker remains for presenting this first-part proposal to the user.

## Verification

Independent Playwright browser run: **36 assertions passed**, with zero browser runtime errors. Executed against the isolated preview at `http://127.0.0.1:5173/design-review/T-081/overview.html`.

Coverage includes:

- Global/page-filter visibility; loaded logo; matching current app font declaration.
- Global KPI aggregation and exact seven-day/thirty-day chart reconciliation.
- Direct business chip, direct logo navigation and retained working-business context.
- One-click Inbox destination and two-click business picker.
- Source/Sales/page filter applicability and incompatible-filter reset on business switch.
- Accessible collapsed navigation and mobile drawer labels after desktop collapse.
- Inert mobile background, forward/reverse keyboard containment, Escape and focus return.
- Invalid custom date validation, one-day graph, integer page rows and page-chart reconciliation.
- At least 12 rendered pixels for mobile chart labels.
- No root horizontal overflow at 375, 768, 1024, 1280, 1440 and 1920 pixels.

Command and log available in this execution environment:

```bash
node /tmp/qa-overview-review.cjs
# /tmp/qa-overview-final-review.log
```

Visual inspection covered desktop overview, mobile overview and mobile navigation. Temporary captures: `/tmp/qa-overview-desktop.png`, `/tmp/qa-overview-mobile.png`, `/tmp/qa-overview-mobile-drawer.png`; final mobile chart geometry was verified programmatically after its polish fix.

## Limits

This preview uses synthetic data and explicitly simulated destinations. Inbox, CRM, billing and other destination screens have not been redesigned or implemented by this artifact. Existing production metric definitions, authorization, data watermarks, freshness states and drilldown records must be retained when implementing the accepted design. Font availability depends on the actual checkout's available font assets; declaration parity does not prove a font binary loaded. The two-business fixture does not constitute acceptance of a large searchable business picker. `pnpm check` and production E2E acceptance are not replaced by this prototype review.

## Iteration 2 — approved scope corrections and anchored account menu

Date: 2026-10-27. Verdict: **approved for product review of the revised prototype**. This iteration supersedes the earlier navigation recommendations above: the user explicitly retained the current module navigation and multichannel grouping.

Verified changes against that direction:

- The current Chat multichannel group and Inbox child are restored, as are the existing expandable Customers and Orders sections and all five Orders subpages. Bot retains its current training label. Statistics is first and is the selected-business default home.
- Both the sidebar business selector and the account control open anchored nonmodal popovers. The account menu opens directly beside the account trigger, never in a centered modal, and directly lists businesses for selection.
- Every simulated module destination uses the business selected on the sidebar. Opening the aggregate statistics view through the logo preserves that selection.
- The aggregate table lists all four fixture shops across the two authorized fixture businesses, with owning-business attribution. Shop row totals reconcile with the aggregate KPI. Shop data remains explicitly synthetic and does not claim a completed backend contract.
- Business selection, search, stored prototype preference, outside dismissal, repeated-trigger toggling and Escape/focus return work on desktop and mobile.

The review found two additional responsive defects: resizing an open mobile drawer to desktop left the main content inert, and expanding both navigation groups on a short mobile screen could move the account below an unscrollable drawer. Both were corrected and passed targeted regressions.

Independent final Playwright run: **51 assertions passed; zero browser runtime errors**. Coverage includes account/business anchor geometry, absence of the centered account modal, preserved navigation, module context, all-shop aggregation, six widths from 375 to 1920 pixels, collapsed-state transition into mobile, outside/repeated-trigger dismissal, drawer-to-desktop resize, and account access with both module groups expanded at 375 × 667 pixels.

```bash
node /tmp/qa-overview-iteration2.cjs
# /tmp/qa-overview-iteration2.log
```

One intermediate test timed out because it targeted the intentionally hidden sidebar business trigger while the desktop sidebar was collapsed. The corrected test targets the visible header business trigger in that state; the final run passes without relaxing the interaction assertions. Same-model inheritance and the production/backend limits of the original review continue to apply. No product source was changed by QA.
