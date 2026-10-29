# Business creation and settings — T-130 design

Status: design proposal, not implemented. Owner feedback: 2026-10-29.

## Model and terminology

An account contains businesses. Each business has one industry template. A Page is a communication channel, not a business or a shop. For the owner's example, TinyMind uses the retail template and Villas uses the lodging template as two separately selected businesses. First-class shops within a business remain a separate account-foundation capability.

Use one canonical editable business name, backed by the existing workspace name. Company/legal name is optional and explicitly labelled. Industry is a structured template choice; free text describes the particular offering and never selects a template.

## Create from the existing business selector

Add a persistent `+ Tạo business` action below the existing business list, including when search has no matches. Keep the current sidebar structure and account menu.

The action opens one compact creation form with two required inputs: business name and template. Show recognizable template choices with a short explanation. Retail and lodging must be distinguishable without opening a preview. Other choices must reflect actual available seed packs; never promise an unsupported operational engine.

A single `Tạo business` submission creates the business, refreshes authorized memberships, selects it, and opens its statistics home. Do not ask for a bot, Page, legal company or full shop profile during creation. Preserve unsaved-work navigation guards, permissions, duplicate-submission protection, and errors without losing inputs. Account ownership follows the current authorized account contract.

## Settings layout

Keep the existing content area. Use a plain horizontal navigation strip without vertical overflow or native scroll arrows.

The information page contains two compact sections:

1. **Business information**: optional logo; one editable `Tên business`; selected template shown as a labelled summary rather than a disabled-looking input; optional legal/company name collapsed under optional company information.
2. **Offering and bot context**: fields labelled according to the selected template. Retail: main products and product/service details. Lodging: accommodation type, location and relevant stay information. These fields describe the real business; template defaults must not invent prices, stock, rooms or policies.

Keep one primary `Lưu thay đổi` action, with pending/success/field-error feedback and unsaved-draft protection. Avoid repeating the editable business name in a separate body card. Sidebar, current-business query, bootstrap membership labels and portfolio labels must refresh after a rename.

Template choice supplies the form labels/default guidance and bot starter content, not a claim that a booking or inventory engine has been implemented. Existing business data and training must survive the redesign; changing an established industry's operational model requires a separately specified migration policy.

## Acceptance

- Create TinyMind/retail and Villas/lodging under the authorized account; both appear in the sidebar and selection controls every scoped screen.
- Creation takes one form and one submission, then opens the new business statistics home.
- Editing the business name changes all visible context labels after save and reload, without modifying another business.
- Industry/template and free-text offering fields cannot be confused by label, control type or examples.
- Template fields/guidance change with the selected business; no cross-business draft leakage.
- No vertical scrollbar/buttons on the settings navigation at supported desktop/mobile widths, either language, keyboard focus and zoom.
- Read-only users cannot create or edit through hidden UI/API paths. Preserve optimistic concurrency and navigation guards.

## Current code findings

- `BusinessSelector` lists memberships but has no creation action; both the baseline and account foundation expose business creation APIs.
- `BusinessIndustry` repeats the workspace name and renders a read-only industry input above a second free-text `businessServices` field.
- Profile edits persist the same workspace name, but `useProfileMutations` only updates the profile query; the sidebar uses bootstrap membership labels and the industry panel uses another workspace query. This permits visible stale name disagreements.
- Settings navigation has `overflow-x-auto` and a negative-bottom-margin child. Browser overflow dimensions require a regression check before confirming the exact cause of the observed native vertical arrows.
- Baseline tested during T-126 is b0f1be6. Account foundation 0859328 must be respected when implementing ownership; this proposal does not certify or deploy it.
