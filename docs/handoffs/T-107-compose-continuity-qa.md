# T-107 independent review and verification

Scope: device-local DM text drafts, personal Enter behavior and T-106 specification handoff. No comment implementation, live customer actions or provider calls were performed in this task.

## Independent review

Two fresh agent reviews used the same model as the primary agent:

- `qa_parallel_inbox_spec` reviewed the T-106 handoff against actual comment contracts/implementation. Four gaps were corrected: manual versus automatic safety, server authorization on the reused action endpoint, nullable action reconciliation, and non-mutating detail reads. Final verdict: approved for the bounded Claude handoff; no live API capability certification.
- `qa_t107_implementation` read the implementation and targeted tests using the review-pr checklist. Findings drove fixes for cross-tab duplicate/stale sends and newer-draft deletion, blocked cleanup rehydration, real remote-session invalidation, quota-failed generation writes, staged-media conflicts, delayed remote logout deleting fresh shared state, and permanent key tombstones. Each was fixed with focused regression coverage. Final scoped verdict: approved, subject to the primary agent's final repository/browser gates.

## Behavior and limitations

Only DM text and minimal text retry identity persist. Attachments, notes, order drafts and follow-up edits remain session-only. The cache is device-local, bounded to seven days and 100 records. It is not cross-device sync or encrypted server storage. A staged attachment remains in its current tab when another tab changes text; users must resolve a conflicting text draft before sending. A browser that refuses every storage mutation cannot be physically erased by application code; memory is invalidated and storage limitations are documented.

Cross-tab reconciliation follows untouched drafts and preserves locally edited drafts behind explicit conflict resolution. Revision comparisons prevent stale completion from clearing newer storage. A shared draft request identity exists before submission so simultaneous sends of that same draft reuse one key. Remote logout expires local session/memory only; the initiating tab owns shared cleanup, so a delayed event cannot delete a newer session's records. Tombstones identify invalidated records, not reusable keys.

## Verification record

- Baseline onboarding `bash scripts/verify-setup.sh`: passed before application implementation.
- Persistence regression suite first failed on three missing behaviors, then passed after implementation.
- Targeted lifecycle suite after final cleanup/tombstone fixes: 3 files, 19 tests passed.
- Initial production build: passed, initial bundle 229.3 KB gzip against the existing 250 KB budget. A final gate rebuild is required after the later lifecycle fixes.
- Initial mocked Chromium browser suite: 2/2 passed for reload, conversation separation, Enter preference persistence, explicit sending, two-tab conflict/send behavior and logout. Final built-source rerun and narrow-screen coverage are recorded in the task log.
- All verification uses synthetic fixtures. No Meta account, customer conversation, public comment or live attachment was changed.

## Final review addendum

The reviewer also confirmed the final storage-recovery delta: unpublished cache generations do not block in-memory editing; persistence is claimed only after publication succeeds; the implicit initial generation is not published and therefore cannot log out a second authenticated tab. Regressions cover blocked publication/recovery and both tabs being authenticated before the first draft is typed. The final frozen-source lifecycle suite passed 3 files and 21 tests.

The composer remains 445 lines to keep its existing tested send/retry control flow together in this increment. New persistence, preferences and popover logic live in separate files; the existing lint size warning is disclosed rather than disabled.

Frozen-source `pnpm check` passed: lint/format, architecture, typecheck, tests and build. Web test summary: 67 files and 454 tests passed. Backend results reused the verified cache (67 files, 1,089 tests); no backend code changed. Final initial bundle: 229.4 KB gzip, within the existing 250 KB limit. Existing backend size warnings and the disclosed composer size warning remain; no check was disabled.

Final production-build Chromium verification passed 21/21 across compose-continuity, Inbox sales/layout and smoke suites. The three new tests cover restored drafts/settings/send/logout, both tabs authenticated before the initial draft plus conflicts/remote logout, and narrow-screen controls. The independent reviewer inspected the synthetic mobile screenshot and confirmed fit/readability. Screenshot remains local at `/tmp/t107-compose-mobile.png`; no real customer media was committed.

## CI blocker T-108

The first CI secret scan flagged three pre-existing generic-api-key fingerprints in main's synthetic public widget embed-code test (commit `9a7e45c6d02344d375a26283239178d2291aa743`, lines 71/73/76). T-108 explicitly scopes the root `.gitleaksignore` change. It lists only those immutable commit/path/rule/line fingerprints; no path/rule/value-wide exclusion, workflow change or history rewrite was made. Independent review confirmed the fixtures are public dummy site keys, not credentials.

Pinned Gitleaks 8.24.3, using the exact CI full-history command, passed over 117 commits with no findings. A fresh synthetic credential in a temporary repository was still rejected with exit 1 using the same ignore file. The probe and its redacted logs remain outside the repo. Fingerprint behavior was checked against the [pinned official documentation](https://github.com/gitleaks/gitleaks/tree/v8.24.3#reducing-false-positives) on 2026-10-27. Required CI must pass before the PR leaves draft.
