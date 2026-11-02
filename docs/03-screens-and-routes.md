# 03 — Screen & route map

> 1-to-1 mapping against the observed Preny routes (`app.preny.ai/quan-ly/...`). Preny's per-field/column/button details: [`reference/preny-dashboard-spec.md`](reference/preny-dashboard-spec.md).
> Our convention: **English, kebab-case** routes in code (`/app/...`), Vietnamese display labels via i18n. If the business wants Vietnamese URLs like Preny, use next-intl `pathnames` to localize — without changing the structure.

## 1. App shell

- **Header:** logo → profile; Home; Guide; Buy plan; AI credit balance badge (→ AI wallet); language selector; notification bell [+]; avatar.
- **Banner** when on the free plan / plan about to expire / wallet empty / channel error.
  - Implemented (T-091): the AI-message banner on every `/app` page, from `GET /api/v1/billing/usage` — amber from 80% of the account's allowance, red once it is spent (bots hand customers to staff until the cycle renews). Not shown for a business that is not metered yet.
- **Sidebar** is collapsible; items carry badges ("Miễn phí" (Free), "Hot", unread count).
- **Two layers, plus the back-office.** The *account layer* (`/app/overview`, `/app/businesses/new`) lists every business of the signed-in account with summary statistics and lets the owner create a business; it has its own sidebar (overview, new business, a shortcut per business, and for platform admins one "Platform admin" entry). The *business layer* (everything else under `/app`) is one business's management area with the sidebar below; it never shows platform pages, even for a platform admin running Rapiz HQ. The *platform back-office* (`/admin/*`) has its own sidebar with only the platform pages and a way back to the businesses; platform admins also reach it from the account menu. The logo always returns to the account layer; choosing a business (overview, sidebar shortcut or the business selector) enters its statistics page. A new business is created with `POST /workspaces` and opened right after.
- Common patterns: empty states with an illustration + CTA; tables with column resizing, row selection, pagination + page size; date range `dd/mm/yyyy – dd/mm/yyyy` with presets; plan-gated screens ("Nâng cấp để sử dụng" (Upgrade to use)) reuse a single component `<UpgradeGate feature=... />`.

## 2. Main sidebar

| Group | Item | Preny route | Our route | Feature | Priority |
|---|---|---|---|---|---|
| Đào tạo Bot (Bot training) | Bot list (create, settings shortcut, delete with confirmation) | `/quan-ly/bot` | `/app/bots` | BOT-01/02 | P0 |
| Chat đa kênh (Omnichannel chat) | Omnichannel messages | `/quan-ly/tin-nhan` | `/app/inbox` | INB-* | P0 |
| | Platform integrations | `/quan-ly/tich-hop-nen-tang/{tab}` | `/app/channels/{all\|pending\|facebook\|instagram\|zalo\|lazada\|tiktok}` | CHN-01..03 | P0 |
| AI Mini CRM | Customer list. A customer linked to KiotViet shows a "KiotViet" badge by its name (list and drawer); its edit form hints on the KiotViet-owned fields, which stay editable. See [integrations/kiotviet.md](integrations/kiotviet.md#customers-in-the-crm) | `/quan-ly/khach-hang` | `/app/contacts` | CRM-01..04 | P0 |
| | Customer lists (segments) | `/quan-ly/tep-khach-hang` | `/app/segments` | CRM-10 | P1 |
| Remarketing | Zalo ZBS | `/quan-ly/chien-dich/zbs` | `/app/campaigns/zbs` (`?tab=list\|stats\|templates`) | MKT-01/02 | P1 |
| | Facebook FMM | `/quan-ly/facebook-marketing-messenger` | `/app/campaigns/fmm` | MKT-04 | P2 |
| | Email | `/quan-ly/chien-dich/email` | `/app/campaigns/email` | MKT-03 | P1 |
| Automation Workflow | | `/quan-ly/automation-workflow` | `/app/workflows` (`?tab=workflows\|zalo-templates`) | WFL-* | P1 |
| | Workflow form | `/quan-ly/automation-workflow/soft-follow-up?industry=retail` | `/app/workflows/new?template=soft-follow-up&industry=retail`, `/app/workflows/{id}` | WFL-02 | P1 |
| Đơn hàng (Orders) | Overview | `/quan-ly/don-hang/thong-ke` | `/app/orders/overview` | ORD-11 | P1 |
| | Order list. With KiotViet push on, a "KiotViet" column (left out when no order on the page was pushed) shows the push chip: "Đang đẩy", "Đã đẩy · <code>" or "Lỗi" (reason on hover) with **Thử lại** (`orders.manage`); mobile cards show the chip only. See [integrations/kiotviet.md](integrations/kiotviet.md#order-push-on-the-orders-pages) | `/quan-ly/don-hang` | `/app/orders` | ORD-04, ORD-15 | P0 |
| | Create order | `/quan-ly/don-hang/tao-moi` | `/app/orders/new` | ORD-03 | P0 |
| | Order detail. A pushed order has a "KiotViet" card: the chip, the failure reason and **Thử lại**, or the KiotViet status and "Đơn đã ở KiotViet — cập nhật trạng thái trên KiotViet" | (not observed) | `/app/orders/{id}` | ORD-05, ORD-15 | P0 |
| | Settings (hub, choose source) | `/quan-ly/thiet-lap` | `/app/order-settings` | — | P0 |
| | ↳ Order settings | `/quan-ly/thiet-lap/cai-dat-don-hang?tab=…` | `/app/order-settings/orders?tab=statuses\|conditions\|gsheet\|chat-order` | ORD-05/06/07/10 | P0–P1 |
| | ↳ Ad optimization | `/quan-ly/thiet-lap/toi-uu-quang-cao` | `/app/order-settings/ads-optimization` | ORD-12 | P1 |
| | ↳ Shipping carrier connections | `/quan-ly/thiet-lap/don-vi-van-chuyen` | `/app/order-settings/carriers` | ORD-08 | P1 |
| | ↳ Shipping settings | `/quan-ly/thiet-lap/cai-dat-van-chuyen` | `/app/order-settings/shipping` | ORD-09 | P1 |
| | ↳ Warehouses | `/quan-ly/thiet-lap/kho-hang` | `/app/order-settings/warehouses` | ORD-02 | P0 |
| Sản phẩm (Products) | Shared product catalog (top-level entry since T-112; Preny nests it under Orders) | `/quan-ly/quan-ly-san-pham` | `/app/products`, `/app/products/{id}` | ORD-01 | P0 |
| Tích hợp PMS (PMS integrations) | Hub of point-of-sale / inventory software (icon `Blocks`; right after Products, or after Platform integrations for hotels; shown with `catalog.manage`, marked "Thử nghiệm" in the sidebar until proven with real shops): KiotViet live, Sapo / Haravan / Pancake POS "Sắp có" | (name only) | `/app/integrations` | ORD-15 | P1 |
| | KiotViet: 3-step connect wizard (credentials → branches → preview & start) until connected, then the connection view (status, sync progress polled every 3 s, counts of linked products, customers and pushed orders, sync settings incl. the "Đẩy đơn sang KiotViet" and "Đồng bộ khách hàng" switches, "Cập nhật mã", recent activity, disconnect). Changes need `settings.manage`; others see it read-only. Guide: [integrations/kiotviet.md](integrations/kiotviet.md) | — | `/app/integrations/kiotviet` | ORD-15 | P1 |
| Lưu trú (hotel businesses only, T-160; replace Sản phẩm in their sidebar) | Lịch — nightly calendar, find availability, holds, bookings, blocks | — | `/app/calendar` | VRT | P0 |
| | Booking — today / holds / upcoming / all, booking sheet; bot holds marked "Bot tạo" with a waiting count and a source filter (T-161) | — | `/app/bookings` | VRT | P0 |
| | Căn hộ — property cards or a compact list (remembered per user) and the editor (info, rooms, prices, policies, photos) | — | `/app/properties`, `/app/properties/$propertyId` | VRT | P0 |
| Thống kê (Analytics) | | `/quan-ly/tong-quan` | `/app/analytics` (`?tab=pages\|interactions\|tags\|current-tags\|statuses\|bot`) | ANA-01/02 | P1 |
| Hạn mức sử dụng (Usage limits) | | `/quan-ly/han-muc-su-dung` | `/app/usage` | BIL-03 | P0 |
| Nâng cấp (Upgrade) | | `/quan-ly/nang-cap` | `/app/upgrade` | BIL-01/08 | P0 |
| Bài viết (Posts) | | `/quan-ly/post-facebook` | `/app/posts` | CHN-08 | P1 |
| Cài đặt (Settings) | Members | `/quan-ly/thanh-vien` | `/app/settings/members` | SET-01 | P0 |
| | Access permissions | `/quan-ly/quyen-truy-cap` | `/app/settings/access` | SET-02 | P0 |
| | Payments & Plans | `/quan-ly/lich-su-giao-dich` | `/app/billing/history` | BIL-07 | P0 |
| | ↳ AI wallet (+ top-up/usage history) | `/quan-ly/vi-tin-nhan[/lich-su-nap-tien\|/lich-su-su-dung]` | `/app/billing/ai-wallet[/topups\|/usage]` | BIL-04 | P0 |
| | ↳ ZBS wallet (+ history) | `/quan-ly/vi-credit[/…]` | `/app/billing/zbs-wallet[/topups\|/usage]` | BIL-05 | P1 |
| | ↳ Voucher | `/quan-ly/doi-voucher` | `/app/billing/vouchers` | BIL-06 | P1 |
| | Affiliate | `/quan-ly/affiliate[/khach-hang\|/quan-ly-link\|/thong-ke\|/danh-sach-giao-dich\|/lich-su-giao-dich\|/thong-tin-ngan-hang]` | `/app/affiliate[/referrals\|/links\|/stats\|/transactions\|/payouts\|/bank]` | AFF-* | P1 |
| | Support tickets | `/quan-ly/ticket-ho-tro` | `/app/support` , `/app/support/{id}` | SET-08 | P1 |
| | Tag settings | `/quan-ly/cai-dat-tag?tagMode=list\|tagQuick\|create` | `/app/settings/tags?mode=list\|quick\|create` | SET-07 | P0 |
| | General settings › Notifications | `/quan-ly/cai-dat-thong-bao` | `/app/settings/notifications` | SET-05 | P0 |
| | › Customer sources | `/quan-ly/nguon-khach-hang` | `/app/settings/sources` | CRM-09 | P0 |
| | › Sync | `/quan-ly/dong-bo` | `/app/settings/sync` | CRM-13 | P1 |
| | › Automation | `/quan-ly/tu-dong-hoa` | `/app/settings/crm-automation` | CRM-14 | P0 |
| | › Statuses | `/quan-ly/trang-thai` | `/app/settings/statuses` | CRM-08 | P0 |
| | › Advanced connections | `/quan-ly/ket-noi-nang-cao/google` | `/app/settings/advanced-connections/{google\|sms\|zns}` | MKT-03 | P1 |
| | › Workspace information | `/quan-ly/thong-tin-workspace` | `/app/settings/workspace` | ACC-07 | P0 |
| | › Business information (T-144) | — | `/app/settings/profile` | ACC-07 | P0 |
| | Security settings | `/quan-ly/cai-dat-bao-mat` | `/app/settings/security` | ACC-05/10 | P1 |
| | Audit log [+] | — | `/app/settings/audit-log` | SET-09 | P1 |
| | Personal profile | `/quan-ly/thong-tin-ca-nhan` | `/app/profile` | ACC-06 | P0 |

> Unlike Preny, our sidebar has no "Chat đa kênh" group: **Tin nhắn đa kênh** (`/app/inbox`) is a top-level item (the page staff use most, one click away) and **Tích hợp nền tảng** (`/app/channels`) is its own top-level item.

## 3. Bot space (`/app/bots/{botId}/…`)

Dedicated layout: back button, bot name, **bot on/off switch**, left menu, **test chat panel on the right** (collapsible), onboarding checklist dialog (x/4).

| Item | Preny route | Our route | Feature |
|---|---|---|---|
| Home + checklist | `/bot/{id}/trang-chu` | `/app/bots/{id}` | BOT-04 |
| Products | `/bot/{id}/quan-ly-san-pham` | `/app/bots/{id}/products` (sells every product or a selection, T-080; "Add product" here selects it via `/app/products/new?botId=`). Hotel bots: "Căn hộ & phòng", a sells/doesn't-sell switch per lodging property (T-160) | BOT-09 |
| Instructions (scenarios) | `/bot/{id}/kich-ban` | `/app/bots/{id}/instructions` | BOT-05/06 |
| Information (FAQ) | `/bot/{id}/du-lieu-huan-luyen` | `/app/bots/{id}/knowledge` (`?tab=faq\|documents`) | BOT-07/08 |
| Channel integrations (Tích hợp kênh) | `/bot/{id}/tich-hop-nen-tang/{tab}` | `/app/bots/{id}/channels/{all\|facebook\|instagram\|zalo\|lazada\|tiktok\|website}` | CHN-04/05 |
| Image library (removed from the menu in T-114) | `/bot/{id}/thu-vien-anh` | `/app/bots/{id}/media` redirects to the bot home; existing images stay available to quick replies and the bot | BOT-10 |
| Settings › Bot setup | `/bot/{id}/tong-quan` | `/app/bots/{id}/settings` (`?tab=basic\|advanced\|schedule`) | BOT-12/13 |
| Settings › Quick messages | `/bot/{id}/tin-nhan-nhanh` | `/app/bots/{id}/quick-replies` | BOT-11 |
| Settings › Edit history | `/bot/{id}/lich-su-chinh-sua` | `/app/bots/{id}/history` | BOT-15 |
| Unanswered questions [+] | — | `/app/bots/{id}/unanswered` | BOT-18 |
| Development › Tool Ads | `/bot/{id}/tool` | `/app/bots/{id}/ads-tool` | BOT-17 |

> Decision: In Preny, **Tin nhắn nhanh** (Quick messages) belongs to the bot. We place it at the **workspace** level (shared by all staff/inboxes), accessible from both the bot and settings — because staff use it in the inbox, and it is not tied to a bot. Recorded in [14](14-open-decisions.md).

## 4. Public & non-dashboard screens

| Screen | Route |
|---|---|
| Sign up / Log in / Forgot password / Verify email / Accept invitation | `/signup`, `/login`, `/login?mode=forgot`, `/verify-email`, `/invite/{token}` |
| Choose a business (several, none remembered, or the current one lost) / Create a business | Account layer: `/app/overview` (`?lost=true` shows the notice; its sidebar lists businesses by account), `/app/businesses/new` (also the welcome step for a user with no business) (T-079, T-126, T-127) |
| Channel OAuth callback | `/oauth/{provider}/callback` |
| Payment: VNPAY result | `/billing/return` |
| Affiliate landing | `/affiliates?ref={code}` |
| Chat widget | Script `widget.<domain>/v1/widget.js?key=wk_…` (Shadow DOM, no iframe); it calls the public API under `/api/v1/webchat/v1/sites/{key}` (ADR-011) |
| Back-office | `admin.<domain>` (separate app, internal SSO, IP allowlist) |

## 5. Inbox wireframe (our design — the Preny inbox could not be captured)

```text
┌───────────────────────┬──────────────────────────────────────┬────────────────────────────┐
│ [Channel ▾][Page ▾]   │ Avatar  Customer name · FB Page A    │ Customer profile            │
│ [Mine|Unassigned|All] │ Bot: ● ON  (paused until 14:35)  [↔] │ Phone: 09xx (AI) [✓ confirm]│
│ 🔍 name/phone/content  │ Sale: Lan ▾   Status: Browsing ▾     │ Address: ... (AI) [✓]       │
│ Filter: tag, status,   │──────────────────────────────────────│ Source: Facebook · Ad #123  │
│ has phone, needs human │  Customer: áo này còn size M ko      │ Tag: [VIP] [+]              │
│───────────────────────│  Bot(Smart): Dạ còn ạ … [product card]│ Notes (2) · Reminders (1)  │
│ ● Nguyễn A  FB  2'    │  ⚠ Handoff: return request >7 days    │ Recent order: #1024 Shipping│
│   "còn size M ko" 🏷VIP│  Lan: em kiểm tra giúp chị nhé        │ ─────────────────────────── │
│ ○ Trần B  Zalo  15'   │                                       │ [+ Create order from chat]  │
│   🔴 needs human       │ ┌──────────────────────────────────┐ │ History: 3 past chats      │
│ ...                    │ │ @ type shortcut · 📎 · 🖼 · 🛍 item │ │                            │
│                        │ └──────────────────────────────────┘ │                            │
└───────────────────────┴──────────────────────────────────────┴────────────────────────────┘
```

## 6. UI design

- Do not copy Preny's identity (logo, purple-pink colors, copy) — only learn from the information architecture. Build our own design system (shadcn/ui + our own tokens), with dark mode support.
- Prioritize high information density for CRM/order tables (users are salespeople operating many hours a day), keyboard shortcuts (F2/F6 like Preny, `/` to search, `J/K` to switch conversations).

## Business selector and business information (T-144)

- The sidebar business selector lists the caller's businesses and always ends with **+ Tạo business**. It opens a dialog with a business name and a template (`Industry`, with a one-line description each; no default). Submitting calls `POST /workspaces` (the server picks the caller's only owned account, ADR-012), reloads the memberships and switches to the new business, landing on `/app/analytics`. The dialog is composed in `routes/app.tsx` and passed through `AppShell` (shared components may not import features).
- `/app/settings/profile` is one card: logo, a single editable business name, the template as a read-only summary (chosen at creation, never changed afterwards), and an optional company name in a collapsed section. Facts the AI uses (address, policies…) are entered per bot under Business information. The workspace fields `businessServices` and `productDescription` are deprecated: no longer shown, still accepted by the API.
- After a rename the session memberships (selector), the current-business query and the profile query are refreshed without a reload.
- The settings tab strips (`/app/settings`, `/app/crm-settings`, `/app/order-settings`) share `components/settings-tabs.tsx`: horizontal scroll only, baseline drawn as an inset shadow so the strip never scrolls vertically.

## SaaS routes (ADR-020, ADR-021)

- A SaaS business has no pages of its own: subscriptions live on the customer sheet (**Subscription** card, with a **History** toggle) and in the customer list's summary strip and columns. Workflow and API: [SaaS businesses](saas.md).
- `/app/crm-settings/saas-plans` (tab **Gói dịch vụ**, shown only for a SaaS business): the plan catalog — name, a price per billing period, archive / restore.
- A customer or subscription synced from a Rapiz account (Rapiz HQ) carries a **Rapiz** badge; its phone and email, and the subscription's plan, stage, period, MRR and dates, are read-only with a lock hint.

## Hotel routes (T-160)

- A hotel business's sidebar shows **Lịch** (`/app/calendar`), **Booking** (`/app/bookings`) and **Căn hộ** (`/app/properties`, detail `/app/properties/$propertyId`) instead of Sản phẩm. Each page renders only for a hotel business (`HotelOnly`).
- Redirects: `/app/accommodations` → `/app/properties`, `/app/stays` → `/app/bookings` (T-155 addresses); `/app/products` and `/app/products/{id}` → `/app/properties` for a hotel business.
- The Inbox sales panel of a hotel business opens the booking sheet with the contact prefilled and lists the conversation's bookings. Workflow and API: [lodging](lodging.md).
- Bot holds (T-161, [ADR-019](adr/ADR-019-bot-lodging-holds.md)): the sidebar **Booking** item shows how many bot holds wait for staff (`GET /lodging/bookings/review-count`, polled every minute; composed in `routes/app.tsx` and passed through `AppShell` as `navCounts`). On `/app/bookings` the **Giữ chỗ** tab carries the same count, bot bookings carry a **Bot tạo** badge (amber while waiting), and the **Nguồn** filter sends `?source=`. The booking sheet of a bot booking opens with a banner: while the hold waits, "Bot đã giữ chỗ theo yêu cầu khách — gọi xác nhận rồi bấm Xác nhận"; afterwards a quiet "made by the bot" line; both with **Mở hội thoại** (`/app/inbox?conversation=`).

## Owner assistant bubble (T-170)

- Every `/app` page shows a round rabbit launcher bottom-right for an active **owner** of the account; billing members and business staff never see it. It is composed in `routes/app.tsx`. On bot pages (`/app/bots/{botId}/…`) it sits higher so it does not cover the **Chat thử** button.
- The launcher opens a side panel ("Thỏ Rapiz"): the owner's threads (searchable, pinned first; pinning and archiving exist in the API only), the conversation, and **Xem các bước** under an answer (tool names, ok/error, duration). While a turn runs the panel shows the steps so far. Switching business starts a fresh conversation.
- The assistant can move the owner to another `/app` page and highlight a control on the current page. Controls it may point at carry `data-assistant-target`: `products.new`, `orders.new`, `bots.new`, `channels.connect`, `products.save`, and since T-175 `bot-profile.save`, `bot-personality.save`, `business.create`, `business-settings.save`, `faq.new`, `scenario.new`, `scenario.starter` (the "Gợi ý theo ngành" button) and `quick-reply.new`.
- The assistant can fill a form on screen that the page registered (`useAssistantForm` in `apps/web/src/lib/assistant-context.ts`); it never submits it. Registered forms (T-175 added all but `product`; spec [shop autofill](superpowers/specs/2026-11-02-owner-assistant-shop-autofill-design.md) §4):
  - `product` on `/app/products/new`: code, name, category, description, first variant's SKU and price.
  - `bot-profile` on `/app/bots/{botId}/knowledge`: the industry's profile fields except the Google Maps link, plus notes.
  - `faq` on the knowledge page: question and answer of a new FAQ.
  - `bot-personality` on `/app/bots/{botId}/instructions`: mission, greeting, pronouns, reply length, tone, emoji.
  - `scenario` on the instructions page: title, trigger, instruction and section of a new scenario.
  - `quick-reply` on `/app/bots/{botId}/quick-replies`: shortcut and content of a new quick reply (never the image).
  - `bot` on `/app/bots`: the new bot's name (only with `bots.manage` and a supported industry).
  - `business` on `/app/businesses/new`: name and industry (the page's own industry list; never the account picker).
  - `business-settings` on `/app/settings/profile`: display name and company name (never the icon).

  Editing an existing row never registers a form. The FAQ, scenario, quick-reply and new-bot forms live in dialogs: while the dialog is closed the list registers the form, and a fill opens the add dialog with the draft; while it is open the dialog registers the same id itself (the registry keeps a stack per id, so closing the dialog hands the id back to the list). After a fill that opens a dialog the panel closes and spotlights nothing; after any other fill with a save button the panel steps aside and spotlights it (for example **Lưu sản phẩm**) so the owner reviews and saves. If the form is not on the page, a toast says so.
- **Nhờ trợ lý điền mẫu** (owner only): the empty FAQ, scenario and quick-reply lists, and the business-profile card while a required basic field is empty, show this button. It sends a fixed request to the assistant (the bubble opens and sends it, or puts it in the composer while a turn runs); the knowledge, instructions, quick-reply, create-business and business-settings pages describe themselves to the assistant (title, bot id and industry).
- A change the assistant prepares (a write) shows as a card under its answer: summary, business, **Xem chi tiết** (the preview as JSON) and **Áp dụng** / **Bỏ**. Nothing changes until the owner presses **Áp dụng**. A decided card becomes one status line (applied, failed with its code, dismissed, expired), and the decision's event message appears in the thread.
- **Trợ lý nhớ gì** (brain button in the panel header) lists what the assistant remembers: about the owner, general notes and one store per business, each with its character use against the limit. The owner can forget an entry (with an inline confirm).
- Backend and flow: [04 §5](04-system-architecture.md), [ADR-023](adr/ADR-023-owner-assistant.md).
