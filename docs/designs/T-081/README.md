# Statistics design — iteration 2

Status: proposed design, 2026-10-27. Tracked by T-081. This is a standalone synthetic prototype. No application module, production navigation, route, API, schema or customer data is changed.

## Approved product direction

One account can contain several businesses, and a business can contain several shops. The business selected at the top of the sidebar controls every business-scoped item beneath it. Statistics is the first item and the business's default home. Clicking the Rapiz logo shows aggregate statistics for all authorized shops across businesses. This portfolio view does not erase the working business named in the sidebar/header.

Clicking the account opens a nonmodal dropdown next to that account control, never a centered dialog. The dropdown lists businesses directly and includes account-level plan/usage access. The sidebar business selector also opens beside its trigger, with search. Selecting a business updates the business home immediately in this prototype; the final deep-module switching contract belongs to T-079. Account plan/usage remains account-scoped.

## Scope correction from iteration 1

The user explicitly rejected unrelated navigation redesign. The multichannel group and its existing inbox child are restored. Existing customer and order groups, subpages, bot label and integration entry remain. Only the statistics entry moves to the top as requested. No redesign of inbox, CRM, bot training, integrations or commerce is included. Module buttons in the prototype only display a scope explanation; their actual existing screens are unchanged.

## Project evidence and skill use

The serving checkout is `agent-sale-main`. Current screenshots were captured using the repository's synthetic `mockApi` fixtures. Inspected: `components/app-shell.tsx`, `components/layout/app-sidebar.tsx`, `features/bot/components/training-nav.tsx`, `features/conversation`, `features/analytics/components/statistics-page.tsx`, `filter-bar.tsx`, and `lib/filters.ts`.

The user-supplied UI/UX Pro Max skill was read at `/home/kenknight/Downloads/ui-ux-pro-max-skill-main/.claude/skills/ui-ux-pro-max/SKILL.md`. A broad design-system search partly returned irrelevant landing patterns; these were rejected. A narrower data-dashboard search informed density and readability. Rapiz's existing colors and logo are preserved. The prototype uses the serving app's declared font stack (`Be Vietnam Pro`, system-ui); no bundled font binary exists in that checkout, so fallback can render. Product typography is untouched.

## Statistics layout

Four existing metrics lead: opened conversations, newly created customer records, captured phone numbers and inbound messages. Existing tag, status, outbound-message and unavailable-comment metrics remain in detailed analysis. Date presets, arbitrary date ranges, current-month shortcut and secondary source/Sales filters remain available.

Page filtering belongs to the conversation chart; it must not silently filter unrelated customer cards. Source affects customer/phone metrics; Sales additionally affects tags/statuses. The applied-filter summary explains this. The all-shop view hides business-specific filters.

The shop table shows shop, owning business, conversation count and inbound messages. Its integer conversation rows reconcile to the synthetic totals. Customer cards remain business/account-record scoped, avoiding an unsupported sum of duplicate customers across shops. Shop detail is only a statistics preview, without changing the sidebar business.

Shop persistence/attribution and cross-business aggregation depend on lane A. The prototype demonstrates the desired hierarchy, not a claim that those APIs exist. No new industry KPIs, billing units or stock rules are introduced.

## Interaction and implementation notes

- Default entry opens statistics for the selected business. A prototype-only localStorage key remembers that selection. Production must use the authorized session context and must respect direct links.
- Logo opens all-shop statistics in one click on desktop. Returning to any business-scoped module uses the visibly selected business.
- Account and business popovers position above or below their actual trigger, clamp to the viewport, close on outside interaction or Escape, and restore focus appropriately. They have no dimmed backdrop. A second click on the same trigger closes the menu.
- Mobile keeps the existing drawer pattern. Its contents scroll on short screens; expanding existing navigation groups must not make account inaccessible. Resizing to desktop clears drawer inert state.
- Retain the actual expanded/collapsed sidebar preference. No forced collapse is introduced.
- Production must clear incompatible filters/cache when switching business, handle loading/errors without relabeling stale content, and preserve permission checks, definitions, watermark and freshness semantics. Unauthorized counts are unavailable, not zero.
- For many businesses, keep a short recent-business strip plus a searchable selector. Do not render an unbounded strip. The fixture has two businesses and four shops only.
- Implement approved production UI with existing shadcn primitives, token classes, TanStack routing/query state and vi/en catalogs. Do not copy the prototype's standalone DOM/CSS into application code.

## Verification and preview

Same-model independent QA uses inherited parent model without an override. Its iteration-specific verdict is in [qa.md](qa.md).

Author iteration-2 browser coverage checks five widths (375–1920), default business home, first statistics entry, all four shops, preserved working business, anchored account behavior, same-trigger toggle, outside/Escape dismissal, sidebar scope, search, and mobile focus. Additional regressions cover short mobile drawer scrolling and desktop resize recovery. Test scripts/logs are under `/tmp/rapiz-ux-audit/` for this session. Prior iteration evidence remains historical, not a substitute for the latest checks.

The isolated preview is copied into the development app's `public/design-review/T-081/` directory without being linked into product navigation. T-081 implementation acceptance stays open. Full application `pnpm check` is not claimed for these design artifacts.

- [Business home](overview-desktop.png)
- [Account dropdown](overview-account-menu.png)
- [All shops](overview-all-shops.png)
- [Mobile](overview-mobile.png)
