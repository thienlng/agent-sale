# 03 — Screen & route map

> 1-to-1 mapping against the observed Preny routes (`app.preny.ai/quan-ly/...`). Preny's per-field/column/button details: [`reference/preny-dashboard-spec.md`](reference/preny-dashboard-spec.md).
> Our convention: **English, kebab-case** routes in code (`/app/...`), Vietnamese display labels via i18n. If the business wants Vietnamese URLs like Preny, use next-intl `pathnames` to localize — without changing the structure.

## 1. App shell

- **Header:** logo → profile; Home; Guide; Buy plan; AI credit balance badge (→ AI wallet); language selector; notification bell [+]; avatar.
- **Banner** when on the free plan / plan about to expire / wallet empty / channel error.
  - Implemented (T-091): the AI-message banner on every `/app` page, from `GET /api/v1/billing/usage` — amber from 80% of the account's allowance, red once it is spent (bots hand customers to staff until the cycle renews). Not shown for a business that is not metered yet.
- **Sidebar** is collapsible; items carry badges ("Miễn phí" (Free), "Hot", unread count).
- **Workspace switcher** (P2).
- Common patterns: empty states with an illustration + CTA; tables with column resizing, row selection, pagination + page size; date range `dd/mm/yyyy – dd/mm/yyyy` with presets; plan-gated screens ("Nâng cấp để sử dụng" (Upgrade to use)) reuse a single component `<UpgradeGate feature=... />`.

## 2. Main sidebar

| Group | Item | Preny route | Our route | Feature | Priority |
|---|---|---|---|---|---|
| Đào tạo Bot (Bot training) | Bot list (create, settings shortcut, delete with confirmation) | `/quan-ly/bot` | `/app/bots` | BOT-01/02 | P0 |
| Chat đa kênh (Omnichannel chat) | Omnichannel messages | `/quan-ly/tin-nhan` | `/app/inbox` | INB-* | P0 |
| | Platform integrations | `/quan-ly/tich-hop-nen-tang/{tab}` | `/app/channels/{all\|pending\|facebook\|instagram\|zalo\|lazada\|tiktok}` | CHN-01..03 | P0 |
| AI Mini CRM | Customer list | `/quan-ly/khach-hang` | `/app/contacts` | CRM-01..04 | P0 |
| | Customer lists (segments) | `/quan-ly/tep-khach-hang` | `/app/segments` | CRM-10 | P1 |
| Remarketing | Zalo ZBS | `/quan-ly/chien-dich/zbs` | `/app/campaigns/zbs` (`?tab=list\|stats\|templates`) | MKT-01/02 | P1 |
| | Facebook FMM | `/quan-ly/facebook-marketing-messenger` | `/app/campaigns/fmm` | MKT-04 | P2 |
| | Email | `/quan-ly/chien-dich/email` | `/app/campaigns/email` | MKT-03 | P1 |
| Automation Workflow | | `/quan-ly/automation-workflow` | `/app/workflows` (`?tab=workflows\|zalo-templates`) | WFL-* | P1 |
| | Workflow form | `/quan-ly/automation-workflow/soft-follow-up?industry=retail` | `/app/workflows/new?template=soft-follow-up&industry=retail`, `/app/workflows/{id}` | WFL-02 | P1 |
| Đơn hàng (Orders) | Overview | `/quan-ly/don-hang/thong-ke` | `/app/orders/overview` | ORD-11 | P1 |
| | Order list | `/quan-ly/don-hang` | `/app/orders` | ORD-04 | P0 |
| | Create order | `/quan-ly/don-hang/tao-moi` | `/app/orders/new` | ORD-03 | P0 |
| | Order detail | (not observed) | `/app/orders/{id}` | ORD-05 | P0 |
| | Product management | `/quan-ly/quan-ly-san-pham` | `/app/products`, `/app/products/{id}` | ORD-01 | P0 |
| | Settings (hub, choose source) | `/quan-ly/thiet-lap` | `/app/order-settings` | — | P0 |
| | ↳ Order settings | `/quan-ly/thiet-lap/cai-dat-don-hang?tab=…` | `/app/order-settings/orders?tab=statuses\|conditions\|gsheet\|chat-order` | ORD-05/06/07/10 | P0–P1 |
| | ↳ Ad optimization | `/quan-ly/thiet-lap/toi-uu-quang-cao` | `/app/order-settings/ads-optimization` | ORD-12 | P1 |
| | ↳ Shipping carrier connections | `/quan-ly/thiet-lap/don-vi-van-chuyen` | `/app/order-settings/carriers` | ORD-08 | P1 |
| | ↳ Shipping settings | `/quan-ly/thiet-lap/cai-dat-van-chuyen` | `/app/order-settings/shipping` | ORD-09 | P1 |
| | ↳ Warehouses | `/quan-ly/thiet-lap/kho-hang` | `/app/order-settings/warehouses` | ORD-02 | P0 |
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
| | Security settings | `/quan-ly/cai-dat-bao-mat` | `/app/settings/security` | ACC-05/10 | P1 |
| | Audit log [+] | — | `/app/settings/audit-log` | SET-09 | P1 |
| | Personal profile | `/quan-ly/thong-tin-ca-nhan` | `/app/profile` | ACC-06 | P0 |

## 3. Bot space (`/app/bots/{botId}/…`)

Dedicated layout: back button, bot name, **bot on/off switch**, left menu, **test chat panel on the right** (collapsible), onboarding checklist dialog (x/4).

| Item | Preny route | Our route | Feature |
|---|---|---|---|
| Home + checklist | `/bot/{id}/trang-chu` | `/app/bots/{id}` | BOT-04 |
| Products | `/bot/{id}/quan-ly-san-pham` | `/app/bots/{id}/products` (sells every product or a selection, T-080; "Add product" here selects it via `/app/products/new?botId=`) | BOT-09 |
| Instructions (scenarios) | `/bot/{id}/kich-ban` | `/app/bots/{id}/instructions` | BOT-05/06 |
| Information (FAQ) | `/bot/{id}/du-lieu-huan-luyen` | `/app/bots/{id}/knowledge` (`?tab=faq\|documents`) | BOT-07/08 |
| Integrations | `/bot/{id}/tich-hop-nen-tang/{tab}` | `/app/bots/{id}/channels/{all\|facebook\|instagram\|zalo\|lazada\|tiktok\|website}` | CHN-04/05 |
| Image library | `/bot/{id}/thu-vien-anh` | `/app/bots/{id}/media` | BOT-10 |
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
| Choose a business (several, none remembered, or the current one lost) / Create a business | `/businesses` (`?lost=true`), `/businesses/new` (T-079) |
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
