# Tam Dao Villas Central / SKY VILLA A17 acceptance

Date: 2026-10-30. Task: T-155. Source: owner-provided `villa_a17/info.md` and twelve JPGs. The merchant requested API seeding and native Chrome profile Tùng verification. Existing selected-tenant data was backed up privately before mutation. Credentials, booking contacts and raw backups are excluded from Git.

## Seeded business

- One active entire-property A17 accommodation; one reference variant; zero warehouse stock is not an availability signal.
- Eight layout entries: basement, 101, 102, 201, 202, 203, 301 and collective room. Room102 has two 1.8×2m beds. Collective-room mattresses are 1.2×2m; quantities remain unknown. Photos do not establish room numbers.
- Standard24 adults +8 children under6; neither32 adults nor an established absolute maximum. No invented child-free or surcharge policy.
- Mon–Thu12m VND; Friday/Sunday13m; Saturday14m. Rate basis unconfirmed. No assumed nightly unit, deposit, cancellation, holiday, check-in/out or actual availability.
- Profile display name corrected from `Em` to Tam Dao Villas Central, source business contacts applied privately, existing merchant logo retained. General location only; no invented exact address/Maps/hours.
-16 FAQs,8 situations,4 quick replies and12 captioned media references. Existing starter situations were replaced through the API with restore history retained. Connected Page association preserved.
- API readback confirmed one variant,8 bedrooms and12 gallery entries. TinyMind was seeded and pushed separately on `chore/T-153-tinymind-junisprouts-prefill`; this work does not reseed its operational stock.

## Image storage and reproduction

All12 original photos were visually audited and copied unchanged to the established ignored development asset directory, with tenant-scoped gallery/media URLs. Source front-sign contact text was not used to override info.md booking contacts. Source hash manifest remains in the private operator backup.

The bot media-upload endpoint returned503 because S3 storage is not configured. This is an explicit development fallback: photographs are served by the running web server, not uploaded into durable object storage, and are not committed in Git. [Sample metadata](villas-a17-sample-data.json) contains relative gallery paths; resolve against a deployment origin only after copying the owner files into the same tenant asset path or uploading them into configured storage. A changed tunnel origin requires updating gallery/media URLs through the APIs. Do not represent these links as durable production storage.

## Functional verification

- Real PostgreSQL/API integration exercises validation, idempotent replay and changed-payload conflict, RBAC, cross-tenant404, direct forced-RLS visibility/composite FK, concurrent overlapping confirmation, adjacent stays, optimistic conflicts, cancellation and retail-order/stock exclusions.
- Domain/contracts cover real dates, checkout-exclusive ranges, weekday references, unknown-unit total=null, older/missing child ages, standard versus maximum, request lifecycle and pagination beyond100 inquiries.
- UI tests cover stale quote removal, stable retry key, unconfirmed creation, partial child-age rejection, explicit operator confirmation flags/amount, read-only controls and industry navigation; existing retail navigation tests retained.
- Native Chrome profile Tùng: selected Tam Dao Villas Central shows A17 whole-property card,8 bedrooms,24+8-under6 standard,12/13/14m references and unknown policy fields. No invented stock column or shipping/COD flow.
- Browser UI quote for2026-11-06→2026-11-08 shows Friday13m/Saturday14m,2 nights, no computed total, and a reminder to verify real availability. No merchant stay was created during acceptance.
- Actual seeded bot playground: correctly distinguishes8 rooms from8 rentable units and24+8-under6 from32 adults; returns the actual sauna photograph; treats a child exactly6 as outside the under6 allowance without inventing a fee; defers unknown deposit/refund terms; refuses to sum an unconfirmed two-night tariff and asks exact dates for availability. All four replies answered with no guardrail fallback.

## Independent QA

Fresh-context reviewer `/root/villas_qa` inspected source/photos and implementation independently. Initial review requested changes for inaccessible requests after the newest100 and gallery photos/captions missing from AI selection. Both were corrected with pagination and gallery-backed query ranking. Final verdict: **approve, no blocking code findings**. Independent verification:26 backend tests,4 UI tests and `git diff --check` passed. The reviewer made no merchant writes.

## Commands and evidence

- `pnpm --filter @agent-sales/backend exec vitest run src/modules/commerce/__tests__/lodging.spec.ts src/modules/ai/__tests__/lodging-context.spec.ts`:13/13 passed after pagination/gallery fixes.
- `pnpm --filter @agent-sales/web exec vitest run src/features/commerce/components/stay-request-form.test.tsx src/components/layout/app-sidebar.test.tsx`:9/9 passed.
- `pnpm --filter @agent-sales/backend exec vitest run ai/__tests__/evals.spec.ts`:38/38 passed.
- `pnpm --filter @agent-sales/backend eval --live --group lodging-a17`:3/3 critical passed, Hermes/gpt-6.1-sol, prompt sales-agent@10. Initial1/3 exposed premature handoff/fallback; corrected the prompt to answer known standards and clarify unverified availability before rerunning. No assertions or gate thresholds were relaxed.
- `pnpm --filter @agent-sales/backend exec vitest run --config vitest.integration.config.ts test/lodging.integration.spec.ts`:4/4 passed on the final migration/API implementation (33.23s).
- Complete `pnpm check`:passed lint/architecture,22/22 typecheck tasks,19/19 test tasks and13/13 build tasks; backend1268 tests, web608 tests and contracts77 tests pass. Initial gzip241.7KB stays within250KB budget.
- [Live eval result](villas-a17-evals.live.json) records the3 critical grounded cases and replies. All12 gallery URLs returned200 image/jpeg; TinyMind retained59 active products.

Private operator evidence is outside the repository under `/tmp/villas-a17-private/` and `/tmp/villas-a17-*.log`. Screenshots include browser chrome/personal bookmarks and are not committed.

## Practical limits

The source does not provide authoritative availability or commercial policies. Staff must verify them before confirmation. Local confirmed-date exclusion protects this system only, and agreed total is not a payment. No live Messenger customer message or paid reservation was sent. This delivery is a useful one-property inquiry/request/confirmation workflow, with the broader PMS/calendar/payment/appointment architecture documented as future work in ADR-013.
