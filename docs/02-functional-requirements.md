# 02 — Functional requirements (PRD)

> Sources: per-screen Preny specification in [`reference/preny-dashboard-spec.md`](reference/preny-dashboard-spec.md) (extracted from 75 actually observed URLs) + the analysis dossier `preny/preny-research/`.
> Priority convention: **P0** = required for MVP/closed beta · **P1** = required before broad-sale GA · **P2** = post-GA expansion · **P3** = optional/long-term differentiation.
> The **[+]** marker = an improvement over Preny (a weakness/gap recorded during the research).
> Each feature has an ID `MOD-nn` for use in the backlog/issues.

## 0. Product scope

An **AI Sales Agent platform for Vietnamese SMEs**: an AI bot that consults & closes orders on Facebook/Instagram/Zalo/TikTok/Website, an omnichannel inbox for the sales team, Mini CRM, order creation & shipping, remarketing (Zalo ZBS, FMM, Email), follow-up workflows, plan-based billing + credit wallets, affiliate.

Personas: **Shop owner** (Owner), **Sales manager**, **Sales staff**, **Bot configurator**, **Accountant**, **End customer** (messaging), **Internal admin** (back-office), **Affiliate partner**.

---

## 1. Accounts, workspace, onboarding (`ACC`)

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| ACC-01 | Sign-up: full name, email, phone number, password; email verification | P0 | Cannot log in to the dashboard until the email is verified; link/OTP expires in 15' |
| ACC-02 | Email/password login, forgot password (same route, 2 states) | P0 | Rate limit 5 attempts/15'; error messages do not reveal whether the email exists |
| ACC-03 | Google login | P1 | Linked to the account with the same verified email |
| ACC-04 | Phone number verification via OTP (badge "Chưa xác thực" (Not verified)) | P1 | Required before creating a messaging campaign |
| ACC-05 | 2FA TOTP + recovery codes | P1 | Enabling/disabling requires password + current code |
| ACC-06 | Personal profile: avatar (≤1MB, 720×720), name, ID, password, email, phone number, time zone (default GMT+7), invoicing information | P0 | |
| ACC-07 | Auto-create a workspace on sign-up (`{tên}-workspace`); workspace information: logo, name, company name, business services, product description | P0 | The product/service description **is fed into the bot context** [+] |
| ACC-08 | Multiple workspaces / switch workspace | P2 | For agencies managing many shops [+] |
| ACC-09 | Post-sign-up onboarding wizard: choose industry → create a template bot → test chat → connect a channel | P0 | Measure time to "first value" (the bot correctly answers 1 question from the shop's data) |
| ACC-10 | Session management, remote logout | P1 | |
| ACC-11 | Multilingual UI (vi, en) | P1 | i18next in the SPA, Astro i18n on the site; no VI metadata on EN pages (a Preny bug) [+] |

## 2. Bot & training (`BOT`)

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| BOT-01 | Bot list (cards: name, industry, attached channels, status, model tier, message count over 7 days) | P0 | |
| BOT-02 | Bot creation wizard: name, industry (e-commerce, fashion, cosmetics, spa/aesthetics, dental, restaurant, hotel/travel, education/study abroad, real estate, furniture, finance, other), choose page (optional) | P0 | A new bot is seeded with **6 FAQs + 3 scenarios** per industry |
| BOT-03 | Global bot on/off switch | P0 | Off → no replies on any channel; conversations still arrive in the inbox |
| BOT-04 | Bot home page + 4-step checklist (Products, Instructions, FAQ, Integrations) shown as x/4 | P0 | |
| BOT-05 | **Main task** (system role), **greeting**, **reaction response** | P0 | |
| BOT-06 | **Scenario handling instructions**: CRUD, search, bulk delete, Excel export, pagination | P0 | Each scenario: title + handling + (optional) always apply |
| BOT-07 | **FAQ/Information**: CRUD, Excel/CSV import (with sample file, per-row error reporting), Excel export | P0 | Answerable immediately after adding (< 30s to index) |
| BOT-08 | Documents: upload PDF/DOCX/TXT, crawl URL | P1 | Show index status (processing/done/error) |
| BOT-09 | **Bot products** = selected from the operational catalog + product-specific instructions | P0 | [+] A single catalog (Preny splits it into 2 places → bot products are missing from the order form) |
| BOT-10 | Image library: albums, image/video upload, quota per plan | P0 | The bot can send images by album; max 30 images/turn |
| BOT-11 | Quick messages: shortcut `@xxx`, content, images; search | P0 | Typing `@` in the inbox shows suggestions |
| BOT-12 | Basic settings: name, avatar, color, language, model tier, **reply schedule** | P0 | |
| BOT-13 | Advanced settings: all 17 settings (see [06 §6](06-ai-engine.md)) with character limits (classification 2000, fallback 1000) and form-of-address preview | P0 | |
| BOT-14 | **Test chat** (playground) on every bot sub-page, with 3 suggested questions | P0 | [+] Test conversations are flagged `is_test`, not counted toward customer analytics/quota; has a "View knowledge sources used" button |
| BOT-15 | **Edit history** (configuration + knowledge audit) filterable by date, type | P1 | [+] Actually records every change (Preny's is empty) |
| BOT-16 | **Versioning & publishing**: draft → publish; rollback | P2 | [+] |
| BOT-17 | Facebook Ads tool: choose message type (Standard / Template / Quick reply) → preview → JSON | P1 | Valid JSON that can be pasted into Ads Manager |
| BOT-18 | "Questions the bot could not answer" report → 1 click to add an FAQ | P1 | [+] Knowledge improvement loop |
| BOT-19 | Answer rating 👍/👎 + staff corrects the answer → FAQ suggestion | P2 | [+] |
| BOT-20 | Duplicate bot (clone) | P2 | |

## 3. Channel integrations (`CHN`)

Technical details: [07](07-channel-integrations.md).

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| CHN-01 | Workspace-level integrations page: tabs Tất cả (All) / Chờ kích hoạt (Pending activation) / Facebook / Instagram / Zalo / Lazada / TikTok | P0 | |
| CHN-02 | Connect Facebook pages via OAuth (select multiple pages) | P0 | Pages over quota → go to "Chờ kích hoạt" (Pending activation) |
| CHN-03 | Bulk activate/deactivate pages, edit, sync old messages (choose a cut-off point) | P0 | |
| CHN-04 | Attach a page to a bot ("Chọn từ trang có sẵn" (Choose from existing pages)); 1 page ↔ 1 bot | P0 | |
| CHN-05 | Website widget: embed code, customization, domain allowlist | P0 | Locked by plan (entitlement) |
| CHN-06 | Zalo OA (OAuth, display OA plan requirements) | P0 | |
| CHN-07 | Instagram DM | P1 | |
| CHN-08 | Reply to FB/IG comments + send a private message on comment; **Posts** screen to enable/disable per post | P1 | |
| CHN-09 | TikTok Business | P2 | |
| CHN-10 | Lazada | P2 | |
| CHN-11 | Channel health status (expired token, lost permissions, webhook errors) + banner + alert email | P0 | [+] Every error has a remediation action |
| CHN-12 | "Nên tích hợp nền tảng nào tiếp theo?" (Which platform should we integrate next?) form | P3 | |

## 4. Omnichannel inbox (`INB`)

The Preny inbox layout could not be captured → we design it on the standard 3-column pattern (list | conversation | customer profile).

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| INB-01 | Realtime conversation list, sorted by newest message; unread badge; channel/page icon | P0 | New messages appear in < 2s |
| INB-02 | Filters: channel/page, unread, unreplied, assigned to me, unassigned, tag, status, has phone number, bot ON/OFF, needs a human (handoff), date range | P0 | |
| INB-03 | Search by name, phone number, content | P1 | |
| INB-04 | Chat pane: text, emoji, image/video/file, sticker (receive), reaction, product card, album; sending/delivered/seen/failed status | P0 | Send failures show a reason + retry button |
| INB-05 | Sender display: Customer / Bot (model) / Staff (name) / Other platform | P0 | |
| INB-06 | **Per-conversation Auto-reply switch** + display "Bot paused until hh:mm" | P0 | Staff sends a manual message → bot pauses for N minutes, then re-enables automatically |
| INB-07 | Quick messages `@shortcut`, insert images from the library, send product cards | P0 | |
| INB-08 | Assign staff / reassign staff; automatic distribution by rule (by page/ratio/by day) | P0 | No "ownerless" conversations when auto-distribution is on |
| INB-09 | **Handoff**: bot hands over to a human with reason + needs summary + open questions; "Cần xử lý" (Needs action) queue | P0 | [+] |
| INB-10 | Internal notes on messages → synced into customer notes (CRM rule) | P0 | |
| INB-11 | Customer panel: info, AI-extracted phone number/address (1-click confirm), tags, status, assigned salesperson, recent orders, notes, reminders | P0 | |
| INB-12 | **Create order from conversation** (condensed form, prefilled by AI) | P0 | |
| INB-13 | Tag conversations (conversation tags), red tag, silent tag | P0 | |
| INB-14 | 24h window warning (FB) / consultation window (Zalo); suggest using tags/templates | P1 | |
| INB-15 | Conflict detection: 2 staff members composing at once ("X is replying") | P1 | [+] |
| INB-16 | Browser notifications + sound; mobile app | P1 / P2 | |
| INB-17 | AI conversation summary, reply suggestions for staff (copilot) | P2 | [+] |

## 5. Mini CRM (`CRM`)

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| CRM-01 | Customer list: columns Name, Phone number, Email, Source, Status, Salesperson, Tag, Ad ID, Notes, Created at, Last interaction; show/hide columns, table customization, sorting, advanced filtering | P0 | 100k customers/tenant: filtering < 1s |
| CRM-02 | Manually create a customer: at least 1 of Name/Phone number/Email required | P0 | |
| CRM-03 | Customer detail dialog: Overview / Details / History (timeline) / Files | P0 | |
| CRM-04 | Notes, tasks/reminders (tag "Nhắc lịch" (Reminder) + notification offsets) | P0 | Notifications fire exactly at 0'/2h/24h |
| CRM-05 | Multichannel identity: 1 customer with multiple PSIDs/Zalo IDs/phone numbers/emails; controlled **merge & split** | P1 | [+] Wrong merges can be split back without losing history |
| CRM-06 | Duplicate detection (normalized phone number, email) + merge suggestions | P1 | [+] |
| CRM-07 | Tags with **attribute fields** (Attribute / Task tags), color, notes; default system tags Ticket, Nhắc lịch (Reminder), VIP, Event; "quick tags" | P0 | |
| CRM-08 | Ordered customer statuses (pipeline), drag to reorder; 8 statuses by default | P0 | |
| CRM-09 | Customer sources: 7 defaults + custom sources | P0 | |
| CRM-10 | **Customer lists** (segments): system list "Tất cả" (All), dynamic lists by filter, static imported lists | P1 | Counts update; usable as campaign audiences |
| CRM-11 | Customer import (.xlsx/.csv ≤ 50MB): column mapping, dedupe, per-row error reporting | P1 | |
| CRM-12 | Customer export (permission-based, audited) | P1 | |
| CRM-13 | Sync customers from old conversations (backfill job) | P1 | |
| CRM-14 | **9 CRM automation rules** (update when phone number/address changes; notes from messages; create a full profile when phone number + address are present; create new when a phone number appears; when an address appears; from a new conversation; sync when a phone number appears; sync name/phone number/address/gender/source/salesperson info) | P0 | ON by default: notes, info sync; every rule run is logged [+] |
| CRM-15 | Per-channel opt-in/opt-out (consent to receive marketing messages) | P1 | [+] Required before sending campaigns |
| CRM-16 | Workspace-level custom fields | P2 | |

## 6. Orders, products, warehouses, shipping (`ORD`)

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| ORD-01 | Product catalog: code, name, images, description, **variants** (attributes, SKU, sale price, cost price, weight), stock per warehouse; Excel import; product configuration | P0 | Prices stored as integer VND |
| ORD-02 | Warehouses: default warehouse + multiple warehouses; shipping sender info (name, phone number, 2-level address Province/Ward) | P0 | |
| ORD-03 | Full order creation form: multi-tab (F6), F2 shortcut; products (filter in-stock); payment (free shipping, bank transfer, shipping fee, discount VND/%, transferred amount, surcharge); internal/printable notes; time, source; customer; recipient + expected delivery; shipping (shipping carrier, tracking number, fee, COD) | P0 | Correct money formulas (see [05](05-data-model.md) §Orders); idempotent on double-click |
| ORD-04 | Order list: status tabs with counts, search (order code, shipping code, name, address, phone number, notes), filters, sorting, 19 columns, totals footer (product qty, shipping fee charged to customer, COD, total amount) | P0 | Filters: several statuses (include or exclude), source, dates, creator, carrier; OR within a filter, AND across filters; "Tổng số tiền" (gross) and "Tiền cần thu" (amount due) are separate columns |
| ORD-05 | Order statuses: Mới (New), Chờ xác nhận (Awaiting confirmation), Đã đặt hàng (Ordered), Đã xác nhận (Confirmed), Đang đóng hàng (Packing), Chờ in (Awaiting print), Đã in (Printed), Chờ chuyển hàng (Awaiting handover), Đang giao (In delivery), Đã giao (Delivered), Giao thất bại (Delivery failed), Đang hoàn (Returning), Đã hoàn (Returned), Đã hủy (Cancelled); toggleable additional statuses; statuses requiring a note/confirmation | P0 | State machine blocks invalid status transitions |
| ORD-06 | Order creation / confirmation conditions | P1 | |
| ORD-07 | **Orders from chat**: AI creates a draft order, customer confirms, staff approves (auto-approve configurable) | P1 | No duplicates; read the summary back to the customer |
| ORD-08 | Shipping carrier connections (Viettel Post, GHN, GHTK, J&T, SPX); create waybill, cancel, print labels, status webhooks | P1 | No second waybill created on timeout |
| ORD-09 | Shipping settings: free shipping on 100% bank transfer, status that locks sending to the carrier, status when sent directly, delivery days inner/outer city, customizable inner-city wards | P1 | |
| ORD-10 | Google Sheet sync using shipping carrier templates | P1 | |
| ORD-11 | Order overview: Sales, Revenue, Profit, Closed orders, AOV, Product qty, Avg products/order, Avg profit/order; closed goods/returned goods; today by hour; orders created/cancelled/closed/deleted; new customers | P1 | Figures match the order list |
| ORD-12 | **Facebook ad optimization**: send Purchase events (CAPI) for orders from FB/IG pages | P1 | Dedup event_id; log Meta responses |
| ORD-13 | Print orders/sales invoices (print templates) | P1 | |
| ORD-14 | COD reconciliation | P2 | |
| ORD-15 | Order/inventory sync with Pancake, Haravan, Sapo, KiotViet | P3 | |

## 7. Marketing & remarketing (`MKT`)

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| MKT-01 | Zalo ZBS campaigns: list (name, channel, status, total recipients, succeeded, failed, created date, sent date, creator), filter by status/creator/time; Analytics, Template tabs | P1 | |
| MKT-02 | Campaign creation wizard: choose OA → approved template → customer list → map variables → send schedule → **cost estimate** → confirm | P1 | Hold credit; deduct only on success; never send twice to 1 phone number per campaign |
| MKT-03 | Email campaigns (same UI): sending domain, template, mandatory unsubscribe link, open/click/bounce reports | P1 | |
| MKT-04 | FMM: connect ad account, Campaigns / Audiences tabs | P2 | |
| MKT-05 | Campaign statuses: Draft, Pending approval, Scheduled, Sending, Completed, Partially completed, Failed, Cancelled | P1 | |
| MKT-06 | Check each recipient's eligibility (has phone number, opted in, not blocked, within frequency limits) before computing cost | P1 | [+] |
| MKT-07 | Attribution: orders placed within N days after a campaign message → attributed to the campaign | P2 | [+] |
| MKT-08 | SMS, ZNS via partners | P3 | |

## 8. Automation Workflow (`WFL`)

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| WFL-01 | Industry workflow templates: **Silent customer follow-up**, **Soft Follow-up** (left a phone number but no order yet), **After Sales** (post-purchase care) | P1 | |
| WFL-02 | Configuration: name, description, goal, trigger, step sequence (message + delay), stop conditions (red tag, silent tag, has any of the tags, **goal reached**, customer replied), applicable channels | P1 | Stops immediately when the customer places an order |
| WFL-03 | Publish / pause / versions | P1 | |
| WFL-04 | Respect each channel's messaging window; outside the window → use a template (Zalo) or skip | P1 | |
| WFL-05 | Run log: who entered the workflow, why, which steps were sent, why it stopped, attributable orders | P1 | [+] |
| WFL-06 | Zalo Template tab (requires OA) | P1 | |
| WFL-07 | General workflow builder (drag & drop, conditional branches) | P3 | |

## 9. Analytics (`ANA`)

| ID | Feature | Priority |
|---|---|---|
| ANA-01 | Conversation analytics: filter by salesperson, by page, date range; tabs Pages / Interactions / Tags / Current tags / Statuses; total converted interactions, new customers, phone numbers collected; total tags added/removed, conversations, comments, new messages; top tags | P1 |
| ANA-02 | Bot performance: self-resolution rate, handoff rate, response time p50/p95, unanswered questions, credits used per bot | P1 [+] |
| ANA-03 | Staff performance: first response time, number of conversations, closed orders | P2 |
| ANA-04 | Funnel: Conversation → has phone number → order → successfully delivered order, by source/ad ID | P2 [+] |

## 10. Settings, members, notifications (`SET`)

| ID | Feature | Priority |
|---|---|---|
| SET-01 | Members: list (Name, Role, Phone number, Email, Status), invite by email, member quota | P0 |
| SET-02 | Access permissions: roles + permissions; customer distribution mode (Off / by page / by ratio / ratio by day) | P0 |
| SET-03 | Custom roles | P2 |
| SET-04 | General settings (sub-nav): Notifications, Customer sources, Sync, Automation, Statuses, Advanced connections (Google Email; SMS/ZNS coming soon), Workspace information | P0–P1 |
| SET-05 | Notifications: on/off, up to 5 reminder offsets before an event (default 0', 2h, 24h); channels: in-app, email, push | P0 |
| SET-06 | Security settings: 2FA | P1 |
| SET-07 | Tag settings (list / quick tags / create tag) | P0 |
| SET-08 | Support tickets: create (title, department, description, ≤5 images × 2MB), track, discuss | P1 |
| SET-09 | Audit log viewable by Owner/Admin | P1 [+] |
| SET-10 | Export all workspace data; delete workspace | P1 [+] |

## 11. Billing (`BIL`) — details in [08](08-billing-quota-credit.md)

| ID | Feature | Priority |
|---|---|---|
| BIL-01 | Upgrade page: 3 plans + term selection (3/6/12 months), feature comparison, model tooltip | P0 |
| BIL-02 | VNPAY payment + auto-matched VietQR bank transfer; approval status & payment status | P0 |
| BIL-03 | Usage limits (7 cards: Documents, Members, Messages + reset date, Pages, Images, CRM contacts, Storage) | P0 |
| BIL-04 | AI message credit wallet: top-up (presets 100…5,000), rate table by model, top-up history (incl. 10% VAT), usage history grouped by day/week/month | P0 |
| BIL-05 | ZBS credit wallet: top-up (bank transfer/VNPAY), recent transactions, top-up/usage history (Feature column) | P1 |
| BIL-06 | Vouchers: enter code, redemption history | P1 |
| BIL-07 | Plan purchase history: date, invoice number, plan, quantity, term, method, price, invoice file, approval status, payment status | P0 |
| BIL-08 | Buy additional service packs (quota add-ons) | P1 |
| BIL-09 | Header: AI credit balance badge, "Mua gói" (Buy plan) button; free plan banner | P0 |
| BIL-10 | E-invoices | P1 |
| BIL-11 | Auto-renewal (saved card/token) | P3 |

## 12. Affiliate (`AFF`)

| ID | Feature | Priority |
|---|---|---|
| AFF-01 | Terms gate (must agree before entering) | P1 |
| AFF-02 | Overview: referral link (20%/order, 300,000 VND/order), FB share, copy; commission wallet + withdrawal; revenue & sign-up charts (30 days) | P1 |
| AFF-03 | Referred customers: filter by name/email, plan expiry date, status, link; columns orders, value, commission, plan expiry, last payment | P1 |
| AFF-04 | Link management (max 5), click/sign-up/plan purchase statistics | P1 |
| AFF-05 | Customer transactions, withdrawal/receipt history, bank information | P1 |

## 13. Internal back-office (`ADM`)

| ID | Feature | Priority |
|---|---|---|
| ADM-01 | Search/view workspaces, plans, usage, wallets, channels, channel errors | P0 |
| ADM-02 | Approve bank-transfer payments, grant credits, extend plans, override entitlements (reason required) | P0 |
| ADM-03 | Manage plans/prices/vouchers/affiliate rules | P0–P1 |
| ADM-04 | Handle support tickets, SLA 10'–2h | P1 |
| ADM-05 | Impersonate (log in on behalf) with audit + notification to the workspace owner | P1 |
| ADM-06 | Manage industry templates (template FAQs/scenarios/workflows), model map by tier, prompt versions | P0 |
| ADM-07 | Business dashboard: MRR, sign-ups, activation, trial→paid, churn, AI COGS | P1 |
| ADM-08 | Per-workspace feature flags | P1 |

## 14. Public marketing site (`WEB`)

| ID | Feature | Priority |
|---|---|---|
| WEB-01 | Home, Features, Pricing (term selector), Sign up/Log in, Contact/book a demo | P0 |
| WEB-02 | Industry pages (≥ 10 industries), case studies with a measurement methodology | P1 |
| WEB-03 | User guides (docs), SEO blog, careers | P1 |
| WEB-04 | Privacy policy, terms, purchase/payment policy, DPA | P0 |
| WEB-05 | Bilingual vi/en with correct canonical/hreflang; error-free sitemap | P1 |
| WEB-06 | Demo bot on our own website (dogfooding the widget) | P0 |

## 14b. Vertical packs and business objects (`VRT`) — design in `docs/17`

| ID | Feature | Priority | Acceptance criteria |
|---|---|---|---|
| VRT-01 | Industry picker at bot/workspace creation applies a **vertical pack** (seeded FAQs/scenarios with `{{placeholders}}`, statuses, tags, custom fields, workflow templates, KPIs) | P0 | Onboarding checklist not "ready" until all placeholders used by seeded knowledge are filled |
| VRT-02 | Retail pack (e-commerce, fashion, phone, restaurant menu) on the shared catalog | P0 | `catalog_kind` per workspace; product cards and order drafts from chat |
| VRT-03 | Appointment **request** intake (no calendar): bot collects slot preferences, creates `appointments` in `requested`, staff confirm | P0 | Confirmed/attended are conversion events that stop follow-up |
| VRT-04 | Resources + availability rules + `check_availability`/`create_appointment` tools; reminders and no-show follow-up | P1 | Double-booking impossible (unique slot per resource); reschedule/cancel from chat |
| VRT-05 | Quote engine v1: quote forms (spec questions), deterministic price rules as data, `estimate_price`/`create_quote` tools, PDF, versioning, human approval before binding | P1 | Solar example: kWh → kWp → tiered price; LLM never invents numbers |
| VRT-06 | Custom fields on contact/order/appointment/quote/application/product with validation and filtering | P1 | Filter < 150 ms with expression indexes |
| VRT-07 | Conversion events for services (`appointment_confirmed`, `attended`, `enrolled`, `quote_accepted`, `application_submitted`) feeding workflows and ad attribution (CAPI `Schedule`/`Lead`/`Purchase`) | P1 | Events idempotent by object id |
| VRT-08 | Applications (eligibility checklist + document upload + specialist handoff) for finance / study abroad / labor export | P2 | Documents in tenant-prefixed storage; status per document |
| VRT-09 | Per-vertical guardrails (no medical diagnosis, no credit/visa promises) as pack data | P1 | Covered by eval cases per pack |
| VRT-10 | Public API + webhooks for tenants' own systems (PMS, LMS, POS, ERP) | P2 | Scoped API keys, rate limits, signed webhooks |
| VRT-11 | Back-office pack editor and pack versioning; re-apply pack updates without overwriting tenant edits | P2 | — |
| VRT-12 | Vertical KPI dashboards (booking rate, show-up rate, quote-to-order, repeat rate) | P2 | — |

## 15. Non-functional requirements (NFR)

| Group | GA target |
|---|---|
| Availability | API & webhook ingest 99.9%/month; no lost webhooks (persist before ack) |
| Latency | Webhook ack p99 < 500ms; AI response p95 < 8s; dashboard API p95 < 300ms; inbox realtime < 2s |
| Design scale | 10,000 active workspaces, 5,000 channels, 2 million messages/day, bursts of 500 messages/s; 1 tenant ≤ 1 million CRM contacts |
| Data | RPO ≤ 15 minutes (WAL/PITR), RTO ≤ 4 hours; monthly restore-tested backups |
| Security | No open High/Critical vulnerabilities at release; pentest before GA |
| AI quality | 0 critical errors on the critical set; ≥ 90% on the common set (see [13](13-testing-and-quality.md)) |
| Browsers | Latest 2 versions of Chrome/Edge/Safari/Firefox; dashboard responsive ≥ 1280px, inbox usable on tablets; widget mobile-first |
| Accessibility | WCAG 2.1 AA for the widget and public pages; do not lock zoom (`user-scalable=no` is a Preny bug) |
| Localization | Proper Vietnamese with diacritics; currency format `125.000đ`, date `dd/mm/yyyy`, time zone per workspace |
