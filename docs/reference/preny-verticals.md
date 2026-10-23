# Preny — how it serves different industries (input for our vertical packs)

Source dossier: `/Users/thienle/Desktop/Business/agent-sales/preny/preny-research/` (public-site survey dated 23/10/2026 + logged-in free-account dashboard survey the same day). All paths below are relative to that directory unless absolute.

Evidence labels used by the dossier and kept here: **[CB]** = Preny marketing claim (công bố), **[QS]** = directly observed in the dashboard, **[SL]** = dossier author's analysis, **(inferred)** = my inference.

Headline finding: Preny's "industries" are a **content/marketing layer** (17 landing pages + a 7-page "AI Agent" category) sitting on **one generic product**. The only product-level industry hooks observed are (1) an industry picker in the bot-creation wizard, (2) a generic seeded FAQ/scenario set for the chosen industry, and (3) an `?industry=` parameter on workflow templates. Nothing else in the dashboard is vertical-specific. The dossier itself warns: "Không dùng số lượng ngành được viết bài làm số lượng connector có sẵn" (`07-so-do/08-cay-noi-dung-nganh.md`).

---

## A. Every industry Preny targets

### A.0 Inventory

| # | Industry (EN) | VI name | URL slug(s) on preny.ai | Dossier file(s) |
|---|---|---|---|---|
| 1 | Fashion retail | Thời trang | `/5-ung-dung-ai-shop-thoi-trang`, `/case-study-ung-dung-ai-shop-thoi-trang`, `/ung-dung-ai-chatbot-cho-thoi-trang-giup-tang-ty-le-chot-don` | `06-khao-sat-tung-page/03-nganh-nghe/P002-5-ung-dung-ai-shop-thoi-trang.md`, `06-khao-sat-tung-page/04-san-pham-va-case-study/P011-case-study-ung-dung-ai-shop-thoi-trang.md`, `06-khao-sat-tung-page/04-san-pham-va-case-study/P139-ung-dung-ai-chatbot-cho-thoi-trang-giup-tang-ty-le-chot-don.md` |
| 2 | Restaurant / F&B | Nhà hàng | `/7-ung-dung-ai-cho-nha-hang`, `/ung-dung-ai-chatbot-cho-nha-hang` | `03-nganh-nghe/P003-7-ung-dung-ai-cho-nha-hang.md`, `03-nganh-nghe/P137-ung-dung-ai-chatbot-cho-nha-hang.md` |
| 3 | Real estate | Bất động sản | `/ung-dung-ai-agent-cho-bat-dong-san` | `03-nganh-nghe/P117-ung-dung-ai-agent-cho-bat-dong-san.md` |
| 4 | Immigration & study abroad | Định cư và du học | `/ung-dung-ai-agent-cho-dinh-cu-va-du-hoc` | `03-nganh-nghe/P118-ung-dung-ai-agent-cho-dinh-cu-va-du-hoc.md` |
| 5 | Travel / tours | Du lịch | `/ung-dung-ai-agent-cho-du-lich` | `03-nganh-nghe/P119-ung-dung-ai-agent-cho-du-lich.md` |
| 6 | Education / training centers | Giáo dục | `/ung-dung-ai-agent-cho-giao-duc` | `03-nganh-nghe/P120-ung-dung-ai-agent-cho-giao-duc.md` |
| 7 | Gym / fitness | Gym | `/ung-dung-ai-agent-cho-gym` | `03-nganh-nghe/P121-ung-dung-ai-agent-cho-gym.md` |
| 8 | Hotel | Khách sạn | `/ung-dung-ai-agent-cho-khach-san` | `03-nganh-nghe/P122-ung-dung-ai-agent-cho-khach-san.md` |
| 9 | Dental clinic | Nha khoa | `/ung-dung-ai-agent-cho-nha-khoa`, `/ung-dung-ai-chatbot-cho-nha-khoa` | `03-nganh-nghe/P123-ung-dung-ai-agent-cho-nha-khoa.md`, `03-nganh-nghe/P138-ung-dung-ai-chatbot-cho-nha-khoa.md` |
| 10 | Furniture / interior | Nội thất | `/ung-dung-ai-agent-cho-noi-that` | `03-nganh-nghe/P124-ung-dung-ai-agent-cho-noi-that.md` |
| 11 | Spa | Spa | `/ung-dung-ai-agent-cho-spa` | `03-nganh-nghe/P125-ung-dung-ai-agent-cho-spa.md` |
| 12 | Photo studio | Studio | `/ung-dung-ai-agent-cho-studio` | `03-nganh-nghe/P126-ung-dung-ai-agent-cho-studio.md` |
| 13 | Finance (loans/insurance/cards) | Tài chính | `/ung-dung-ai-agent-cho-tai-chinh` | `03-nganh-nghe/P127-ung-dung-ai-agent-cho-tai-chinh.md` |
| 14 | Beauty clinic / aesthetic center | Thẩm mỹ viện | `/ung-dung-ai-agent-cho-tham-my-vien` | `03-nganh-nghe/P128-ung-dung-ai-agent-cho-tham-my-vien.md` |
| 15 | Labor export (overseas work placement) | Xuất khẩu lao động | `/ung-dung-ai-agent-cho-xuat-khau-lao-dong` | `03-nganh-nghe/P129-ung-dung-ai-agent-cho-xuat-khau-lao-dong.md` |
| 16 | Phone / electronics store | Cửa hàng điện thoại | `/ung-dung-ai-chatbot-cho-cua-hang-dien-thoai` | `03-nganh-nghe/P136-ung-dung-ai-chatbot-cho-cua-hang-dien-thoai.md` |
| 17 | E-commerce (generic online retail) | Thương mại điện tử | `/case-study-tang-70-ty-le-chot-don-trong-thuong-mai-dien-tu`, `/ung-dung-ai-tao-don-tu-dong-giup-tang-doanh-thu`; dashboard industry value "Thương mại điện tử" / `?industry=retail` | `04-san-pham-va-case-study/P010-...md`, `04-san-pham-va-case-study/P140-...md`, `08-dashboard-thuc-te/02-bot-ai-va-huan-luyen.md` |
| — | Homepage "five industry scenarios" | thời trang, giáo dục, nha khoa, nhà hàng, làm đẹp | `/` | `06-khao-sat-tung-page/01-trang-chinh/P001-trang-chu.md` (auto-playing demo-chat cards; numbers on cards are not measurements) |

EN variants (`/en/ung-dung-ai-agent-cho-*`, files `09-danh-muc-va-ngon-ngu/P060`–`P083`) carry the **same Vietnamese body text** as the VI pages; the dossier notes "Nội dung chính trích được vẫn giống bản tiếng Việt, dù URL có `/en`" (`09-danh-muc-va-ngon-ngu/P061-en-ung-dung-ai-agent-cho-bat-dong-san.md`). They add no industry information and are skipped below.

Category listing (`/ung-dung-ai-agent`, pages 1–7: `09-danh-muc-va-ngon-ngu/P116`, `P130`–`P135`) is a blog index; pages 1–4 carry the industry posts above, pages 5–7 carry how-to and knowledge posts (tags, multichannel inbox, FMM, Mini CRM, ZBS, PayPal/MoMo, Instagram how-tos). There are no additional industries beyond the 17 listed.

### A.1 The shared "AI Agent for X" template (industries 3–15)

Thirteen pages (`P117`–`P129`) are the **same eight-bullet skeleton** with three slots swapped: (a) entities the bot collects, (b) desired final outcome, (c) the human's role. Verbatim skeleton (from the dossier's paraphrase):

1. Start from the customer-loss points in the industry journey, not from "which chatbot".
2. Use ads/content to build trust and bring interested people into a conversation.
3. Bot collects **[entities]**, captures contact, and **summarizes for the human handler**.
4. Desired outcome: **[outcome]**.
5. Automation nurtures undecided customers and reminds them of the next step.
6. Post-purchase segmentation for survey, upsell, reminder, referral.
7. Human role: **[role]**.
8. Ends with the Preny pitch.

The dossier's per-page caveat is identical across all 13: "Bài là kịch bản ứng dụng, chưa phải bằng chứng mọi connector nghiệp vụ đã phát hành" — i.e. these are application scenarios, not evidence of industry connectors. **No integrations and no numeric KPIs are claimed on any of the 13 pages.**

| Industry | Entities the bot collects ("dữ liệu bot cần") | Claimed outcome | Human role (where bot stops) |
|---|---|---|---|
| Real estate (P117) | project, location, area (m²), payment plan | viewing appointment → transaction | sales does deep consult, confirms project info |
| Immigration & study abroad (P118) | destination country, field of study, foreign-language level, dossier/profile | consultation sign-up or application file | consultant checks eligibility, explains roadmap |
| Travel (P119) | destination, departure date, itinerary, group composition | tour booking | staff check seat availability and tour conditions |
| Education (P120) | course, tuition, schedule, trial class | paying enrolled student | consultant confirms class and learning need |
| Gym (P121) | training goal, package, PT, opening hours | trial session → membership | staff confirm package and suitable guidance |
| Hotel (P122) | stay dates, room type, amenities, policies | room booking | staff **or a system of record** confirms the room |
| Dental (P123) | service need, initial condition, preferred exam time | exam appointment → treatment | staff confirm schedule; dentist makes clinical decisions |
| Furniture (P124) | model/sample, material, dimensions, style | consultation / showroom visit → order | sales confirm specs, options, delivery |
| Spa (P125) | beauty need, service, preferred time | service appointment → return visits | staff confirm schedule and service scope |
| Studio (P126) | concept, shoot package, makeup, outfits, desired date | photo-session booking | studio confirms schedule, resources, package |
| Finance (P127) | product type, need, eligibility conditions, documents | suitable advice → registration | specialist verifies info, eligibility, official dossier |
| Beauty clinic (P128) | service of interest, need, consult schedule | customer arrives on-site and uses service | staff/expert confirm info, handle specialist work |
| Labor export (P129) | target market (country), job order, qualification level, documents | advice → registration → preparation complete | consultant checks eligibility, costs, contract |

### A.2 Industries with richer, non-template pages

**Fashion (P002, P011, P139)**
- Use cases (P002 "5 applications"): (1) consult & close, (2) birthday campaigns, (3) new arrivals, (4) best-sellers, (5) clearance/discount pushes. Shift from buying traffic to re-monetizing customers who already interacted; segmentation + workflows to re-suggest along the journey; positioning "both new sales and repeat purchase".
- Data needed [SL]: up-to-date catalog, sourced birthday data with consent for messaging, purchase history.
- Integrations: none named (workflows are "promoted scenarios; no template or connected data source tested").
- Marketing claims [CB]: P011 "shop case": average conversion 12.15% → 56.59%; new customers 1,450 → 6,975; orders 740 → 3,947 (dossier notes denominators don't reconcile: 740/1,450 ≠ 12.15%). P139 "five shops": before/after averages 20% → 46%, response time down to ~10 s, no shop identities or sample sizes.

**Restaurant (P003, P137)**
- Use cases (P003 "7 applications"): birthday care, new-dish introduction, loyalty-point reminders, table reservation intake, dish/combo advice, offers, after-sales; workflows keyed to events and care calendars; old-customer base as repeat-growth source. P137: bot as reception + after-hours CS; answers **menu, branches, opening hours, promotions**; collects reservation data; keeps interaction history; multichannel + human handoff + re-care; external demo link.
- Data needed [SL]: menu, branch list, hours, capacity, loyalty ledger, offers.
- Integrations: none demonstrated — "không chứng minh sơ đồ bàn, khóa chỗ theo thời gian hay đồng bộ POS" (no table map, no time-slot locking, no POS sync). Must separate "reservation request" from "reservation confirmed by staff/system".
- Claims [CB]: title claims revenue uplift; no benchmark.

**Dental (P123 template + P138)**
- P138: "online receptionist"; basic info about services, address, hours; collects info to receive appointment requests; centralized data; escalation to humans; goal = fewer missed leads, more bookings. [SL] no evidence of real calendar booking, diagnosis, or patient-record integration.

**Phone store (P136)**
- Use cases: mine inbox history as a re-sellable audience; segment by **device line, upgrade need, installment (trả góp), trade-in (thu cũ)**; **pre-order** campaigns and reminders for customers interested in new models; cross-sell, slow-moving stock, raising customer value.
- Integrations named: Automation workflows, **FMM** (Facebook Marketing Messages), **ZBS** (Zalo Business/Broadcast) to activate segments.
- Data needed [SL]: device catalog with fast-changing prices, segment refresh rules.

**E-commerce (P010, P140)**
- P010: personalized CTA case — response speed + CTA; distinguishes purchase-CTA vs consult-info CTA; "+70% close rate" style numbers [CB] with no methodology.
- P140 "AI creates orders automatically": bot gathers missing fields (product, contact, address) and **creates the order in chat**; after-hours order intake; **sends order data back to Facebook for ad optimization (CAPI-like)**; purchase data reused for CRM & re-care. [SL] live inventory, event schema, CAPI protocol not verified; "order created" ≠ "paid/completed".

**Soft Follow-up (P107, cross-industry)**
- Pre-purchase sequence (illustrated as 10 days): remind need → clarify benefits → build trust → handle objections, easing pressure at the end. Post-purchase: thank-you → fitting suggestions → new arrivals → offers → ask for feedback. Replies route to sales.

### A.3 Dossier's industry content tree and "canonical data" table

`07-so-do/08-cay-noi-dung-nganh.md` / `08-cay-noi-dung-nganh-1.mmd` cluster the 17 into three funnels (dossier's own grouping):

```
AI Agent content
├─ Scheduled services (Dịch vụ theo lịch)
│   ├─ Dental / Spa / Beauty clinic
│   ├─ Studio / Hotel / Travel
│   └─ Gym / Education
├─ Long decisions (Quyết định dài)
│   ├─ Real estate / Furniture
│   └─ Finance / Study abroad / Labor export
└─ Retail & returning customers (Bán lẻ và khách quay lại)
    ├─ Fashion
    ├─ Phone
    └─ Restaurant
```

| Group | Final outcome to measure (dossier) | Canonical data to connect for deep automation (dossier) |
|---|---|---|
| Dental / beauty | confirmed appointment + show-up | calendar, staff, services |
| Studio / hotel / travel | valid booking | slots / rooms / seats + policies |
| Gym / education | trial → paid | packages / classes + access rights |
| Real estate / furniture | fit consultation + transaction | project / SKU / quote / options |
| Finance / study abroad / labor | complete dossier handed to specialist | eligibility rules + official documents |
| Fashion / phone | correct order + repeat-purchase margin | catalog, price, stock, purchase history |
| Restaurant | reservation + return | capacity, menu, points, offers |

---

## B. How Preny implements industry differences in the product (dashboard evidence)

### B.1 Industry selection at bot creation — [QS]
- Wizard steps: **name → industry (ngành nghề) → platform selection → finish**. Test bot `NGHIEN-CUU-20261023` created with industry **"Thương mại điện tử"**, no page selected; bot completes and test chat works before any channel is connected; activation switch stays off. (`08-dashboard-thuc-te/02-bot-ai-va-huan-luyen.md`, `08-dashboard-thuc-te/pages/72-bot-e9363.md`, `08-dashboard-thuc-te/09-ket-qua-thu-nghiem.md` T01.)
- Public guide confirms the same step: "tạo bot, tên, avatar, lời chào và chọn ngành" (`06-khao-sat-tung-page/02-huong-dan/P089-huong-dan.md`, `P111-tutorial.md`).
- **The list of industry options in the dropdown was never captured** (grep of `08-dashboard-thuc-te/observations.json` finds only "Thương mại điện tử"). Mapping observed: URL value `retail` ↔ UI label "Thương mại điện tử" (see B.3). (inferred) the dropdown likely mirrors the marketing verticals, but there is no evidence.

### B.2 Seeded FAQ + scenarios per industry — [QS], e-commerce only
After creation the bot already contains **6 FAQs and 3 scenarios ("tình huống")**; onboarding checklist shows 2/4 complete (scenarios + FAQ), rises to 3/4 after adding one product; the missing item is platform integration. (`02-bot-ai-va-huan-luyen.md`, `pages/73-trang-chu-4aeb7.md`, screenshot `08-dashboard-thuc-te/screenshots/02-bot-trang-chu.jpg`.)

**Seeded scenarios (Hướng dẫn xử lý tình huống)** — exact rows from `pages/49-kich-ban-0c9c6.md`:
1. "Khung giờ hoạt động của cửa hàng" (store opening hours)
2. "Khách hỏi địa chỉ/chi nhánh cửa hàng" (customer asks address/branches)
3. "Điều hướng luồng tư vấn mua sắm theo từng bước, không lặp lại" (guide the shopping-consult flow step by step without repeating)

Same page also has fixed slots: **"Nhiệm vụ chính của Bot"** (main mission, editable), **"Chào hỏi khách hàng"** (greeting), **"Khách hàng gửi Reaction"** (auto-reply on reaction), plus "Thêm hướng dẫn", search, Excel export.

**Seeded FAQs** — 4 of the 6 are legible in screenshot `08-dashboard-thuc-te/screenshots/03-faq-du-lieu-thu.jpg` (row 1 is the researcher's own; rows 6–7 are cut off):
| Q (seed) | A (seed) |
|---|---|
| Có thể xem sản phẩm trực tiếp trước khi mua không? | Dạ được ạ, anh/chị có thể ghé xem và trải nghiệm sản phẩm trực tiếp tại cửa hàng trước khi quyết định. |
| Có hỗ trợ đổi hàng khi sản phẩm lỗi không? | Dạ có ạ, nếu sản phẩm gặp lỗi từ nhà sản xuất, cửa hàng sẽ hỗ trợ xử lý theo chính sách hiện hành, anh/chị liên hệ để được tư vấn cụ thể nhé. |
| Cửa hàng nhận hình thức thanh toán nào? | Cửa hàng hỗ trợ nhiều hình thức thanh toán thông dụng để anh/chị thuận tiện khi mua hàng ạ. |
| Đặt hàng hoặc giữ hàng trước như thế nào? | Anh/chị cho em biết sản phẩm quan tâm và thông tin liên hệ, em hỗ trợ giữ hàng giúp mình nhé. |

Observation: seed answers are **non-committal placeholders** (no real policy, price, or address) written in the "Dạ … ạ / anh/chị / em" Vietnamese sales register. (inferred) the two unseen seeds likely cover shipping policy and store location/hours, because the test-chat panel suggests exactly these prompts: **"Cửa hàng ở đâu?"**, **"Chính sách vận chuyển như thế nào?"**, **"Cửa hàng làm việc vào khung giờ nào?"** (`pages/49-kich-ban-0c9c6.md`).

Whether a different industry gets a different seed set was **not tested** (only one bot/industry created). (inferred) the seed vocabulary ("cửa hàng", "sản phẩm", "giữ hàng", "vận chuyển") is retail-specific, so seeds are at least industry-flavored.

### B.3 Workflow templates parameterized by industry — [QS]
- Automation Workflow page: tabs "Workflow" / "Template Zalo"; tagline "Tự động gửi chuỗi tin nhắn bám đuổi khách chưa mua và chăm sóc khách đã mua hàng." (`pages/01-automation-workflow-bfc7d.md`).
- Three template cards, all "Chưa khởi tạo": **"Bám đuổi khách im lặng"** (chase silent customers), **"Soft Follow-up"**, **"After Sales"** (`08-dashboard-thuc-te/04-marketing-va-workflow.md`).
- Opened URL: `/quan-ly/automation-workflow/soft-follow-up?industry=retail`. Form (`pages/04-soft-follow-up-0e98b.md`, screenshot `screenshots/09-workflow-chua-xuat-ban.jpg`):
  - Section **"Ngành nghề"** — combobox showing "Thương mại điện tử" (first section of the form, i.e. industry is the template's primary parameter).
  - **"Thông tin cơ bản"** with a locked **"Mặc định"** badge: name "Soft Follow-up"; description "Khi khách hàng để lại số điện thoại mà không mua hàng, hệ thống sẽ nhắn tin bám đuổi để kích thích khách hàng mua hàng."; goal "Khách hàng có đơn hàng mới lần đầu tiên".
  - **Trigger**: "Khi khách để lại SĐT mà chưa có đơn hàng".
  - **Stop conditions**: customer gets red tag (on), customer gets "silent" tag (on), customer has any of selected tags (picker).
  - **Platform integration**: Facebook / Instagram / TikTok / Zalo connect buttons; Hủy / Xuất bản.
  - (inferred) the "Mặc định" lock means name/description/goal/trigger are template defaults, plausibly generated per industry; the message copy of the sequence itself was not visible on this screen.
- Not verified: publishing, schedule, retry, dedup, attribution; "Template Zalo" needs a connected OA (`04-marketing-va-workflow.md`, `13-gioi-han-va-phan-chua-thu.md`).

### B.4 Other bot-level surfaces (industry-neutral but relevant to a vertical pack) — [QS]
From `02-bot-ai-va-huan-luyen.md`, `pages/49-kich-ban-0c9c6.md`, `pages/75-quan-ly-san-pham-93fd2.md`, screenshot `08-chat-san-pham.jpg`:
- **Product/service ("Thông tin sản phẩm/dịch vụ")**: name, code, **price as free text** ("125.000 VND. Đây là sản phẩm…"), description, image, and **per-product instructions** ("hướng dẫn riêng từng sản phẩm"). Bot answers with a product card. Bot catalog is **separate** from the order-module catalog (product added to bot did not appear in order form — `05-don-hang-va-van-chuyen.md` T17).
- **Info/FAQ ("Thông tin")**: manual add, file import, Excel export.
- **Media**: albums, image/video upload (max 30 images sent as collection).
- **Quick replies** (shortcuts like `@lab20261023`), **edit history**.
- **Basic settings**: name, avatar, colour, language, model (Smart/Pro/Neo), reply schedule.
- **Advanced settings**: reply to first message; reply to comments; proactive Messenger on comment; response speed; creativity; **customer-classification instructions**; fallback when not understood; **handoff template to staff**; fixed pronouns / customer name / gender-based address on Facebook; image reading toggle; **stop after enough contact info collected**; 5-min silence when a human answers from another platform (UI mentions Pancake/Haravan); **24-hour chase** and **follow-up after phone number captured** (both off on test bot).
- **Onboarding checklist** (4 items): product/service info; scenario guidance; FAQ set; platform integration (Fanpage Facebook, Instagram, TikTok, Zalo, Lazada).
- Verified AI behaviour (4 prompts): exact and paraphrased FAQ answered; declared product price returned with card; unknown SKU → "cần kiểm tra lại… chưa có dữ liệu" (no invented price/stock) (`09-ket-qua-thu-nghiem.md`).

### B.5 Workspace-level surfaces — same for every industry — [QS]
- **Inbox**: multichannel, auto-reply per conversation, tags, statuses, agent assignment (`03-inbox-va-crm.md`).
- **Mini CRM**: sources (Facebook, Instagram, Zalo, TikTok, Website, Lazada, Hotline, custom); pipeline statuses **"New data, Cuộc gọi, Đúng chăm sóc, Tham khảo, Chăm sóc zalo, Trial, Chốt đơn, Đóng"** (note "Trial" is service/education flavoured but it is one fixed list); system tags **Ticket (7 fields), Nhắc lịch/Reminder (7), VIP (5), Event (6)** (`pages/25-cai-dat-tag-9d24a.md`); customer dialog with Overview/Detail/History/Files, timeline, notes, task/reminder tags.
- **CRM automation rules** (`pages/33-tu-dong-hoa-6526f.md`): all keyed to phone/address/new-conversation (create/update customer, sync name/phone/address/gender/source/sales rep). Nothing about bookings, quotes, or industry fields.
- **Remarketing**: FMM (Facebook Marketing Messages), ZBS (Zalo), Email, SMS/ZNS "coming soon", Tool Ads Facebook (click-to-Messenger JSON generator with Thường / Theo mẫu / Trả lời nhanh types) (`04-marketing-va-workflow.md`).
- **Orders** (`05-don-hang-va-van-chuyen.md`, `pages/09-tao-moi-0cefd.md`): warehouse picker, SKU search with "còn hàng" filter, payment (free ship, bank transfer, shipping fee, discount, surcharge, COD), notes (internal / print), order source, customer (gender, name, phone, email, DOB), receiver + address + expected delivery datetime, carrier (Viettel Post, SPX Express, J&T Express) + tracking code, Google Sheet export, "đơn từ chat" tab, ad-optimization tab (Facebook source only). This is a **physical-goods e-commerce** order object; there is no booking/appointment/quote object anywhere.
- **Integrations matrix** (`06-tich-hop.md`): Facebook, Instagram (UI claims purchase-event CAPI), Zalo OA, Lazada (paid), TikTok Business, website widget (paid), Google/Gmail, Google Sheet, Viettel Post, SPX, J&T; Pancake/Haravan only named in a tooltip. No PMS, POS, LMS, calendar, CRM/ERP, or quoting connectors.
- **Pricing** (`06-khao-sat-tung-page/01-trang-chinh/P006-bao-gia-dich-vu.md`): one free + three paid tiers by **scale** (channels, staff, CRM rows, storage, AI model); nothing priced per industry. Credit per message by model: V1/2/3 60đ, Smart 110đ, Pro 150đ, Neo 195đ (`08-dashboard-thuc-te/observations.json` rows).
- **Model/guardrails** (`04-san-pham-va-case-study/P098`, `P099`): fact-check step before answering on price/promo/stock/policy; Pro = balance, Neo = multi-model; v4 adds context, product catalog, multi-field order capture, "needs human" tag. All industry-neutral.

### B.6 Summary of what IS vs IS NOT industry-specific

| Industry-specific (observed) | Not industry-specific (same UI for all) |
|---|---|
| Industry picker in bot wizard | Inbox, CRM fields/statuses/tags, automation rules |
| Seeded 6 FAQ + 3 scenarios (retail-flavoured wording; other industries untested) | Order module, carriers, warehouse |
| `?industry=` on workflow templates; "Ngành nghề" is the first field of the template form | Workflow trigger/stop logic (phone captured, no order, tags) |
| Marketing pages and homepage demo cards | Integrations, pricing tiers, model choice, advanced bot settings, media, quick replies |

---

## C. Cross-industry patterns

### C.1 Capabilities that recur (and where)

| Capability | Industries where the page claims it | Product surface that would carry it |
|---|---|---|
| **Lead capture + summary for human** (collect entities, get phone, hand over) | all 13 template industries + dental P138 + restaurant P137 | bot "stop after contact captured", CRM auto-create on phone, handoff template |
| **Nurture / soft follow-up of undecided leads** | all 13 + fashion + phone + P107 | Soft Follow-up & "Bám đuổi khách im lặng" workflows; 24h chase setting |
| **Post-purchase segmentation: survey, upsell, reminder, referral** | all 13 + fashion + restaurant + phone | After Sales workflow, tags/segments, FMM/ZBS/email |
| **Booking / appointment intake** (request, not confirmed slot) | dental, spa, beauty clinic, studio, hotel, travel, restaurant (table), gym (trial session), education (trial class), real estate (viewing) | **none dedicated** — captured as free text/tags; "Nhắc lịch" tag is the closest object |
| **Catalog Q&A with product cards** | fashion, phone, e-commerce, furniture, restaurant (menu) | bot product list (free-text price), FAQ |
| **Order creation in chat** | e-commerce (P140), fashion, phone | order form, "đơn từ chat" tab, Facebook CAPI claim |
| **Quotation / option fitting** | furniture (specs, materials, dimensions), real estate (payment plan), finance (product fit) | **none** — human does it |
| **Eligibility / document checklist** | finance, study abroad, labor export | **none** — bot collects "hồ sơ" as text, specialist verifies |
| **FAQ: hours, address/branches, policies, payment** | seeded for every bot; emphasized for restaurant, dental | seeded scenarios + FAQ |
| **Event / lifecycle campaigns** (birthday, new arrivals, points, pre-order) | fashion, restaurant, phone | tags (Event, VIP), FMM/ZBS campaigns, DOB field in CRM/order |
| **After-hours reception** | restaurant, dental, e-commerce | bot reply schedule |

### C.2 Capabilities unique to a few industries
- **Installment / trade-in / pre-order segmentation** — phone store only.
- **Loyalty points reminder, combo/dish recommendation, table capacity** — restaurant only.
- **Room type / amenities / stay-date / policy** — hotel; **seat availability / tour conditions** — travel.
- **Clinical boundary** ("bác sĩ quyết định chuyên môn") — dental/beauty.
- **Concept / makeup / outfit / resource scheduling** — studio.
- **Country / job order / qualification / contract cost** — labor export; **country / major / language level** — study abroad.
- **Project / location / area / payment plan** — real estate; **material / dimension / style** — furniture.
- **PT and training-goal matching** — gym.
- **Send order data back to Facebook for ad optimization** — e-commerce/retail only.

### C.3 Structural pattern worth copying
Every vertical page is "entities → outcome → human role". That triple is exactly what a vertical pack needs to parameterize: (1) the **slot schema** the bot must fill, (2) the **conversion event** that counts as success (and the stop condition for follow-up), (3) the **handoff rule**. Preny expresses these only in prose; the product does not model them.

---

## D. Gaps / opportunities (what an industry needs that Preny does not visibly offer)

Evidence base: `07-so-do/08-cay-noi-dung-nganh.md` (canonical-data table), `02-san-pham/01-ban-do-tinh-nang.md` ([CXN] list: no public API/webhooks, ERP/POS sync, general workflow builder, live inventory, voice, auto-collection of payment), `08-dashboard-thuc-te/06-tich-hop.md`, `05-don-hang-va-van-chuyen.md`, `12-cap-nhat-ket-luan.md`.

1. **No booking/appointment object or calendar.** Dental, spa, beauty, studio, gym, education, restaurant, real-estate viewings all end in "staff confirm the slot". Opportunity: slot/resource calendar (staff, chair, room, table, class), availability check in chat, confirmed-vs-requested states, reminders/no-show follow-up, Google Calendar / booking-engine sync.
2. **No room/seat/tour availability or PMS/OTA connector** for hotel and travel; policies (cancellation, check-in) only as FAQ text. Opportunity: inventory-by-date, rate plans, deposit links.
3. **No class/course schedule or package entitlement** for education and gym ("gói/lớp và quyền tham gia"). Opportunity: course catalog with sessions, trial-class slots, membership tiers, renewal reminders.
4. **No quoting engine.** Furniture (dimensions, material → price), real estate (payment plan), and anything B2B are left to humans. Opportunity: configurable quote forms/price rules (e.g. solar: roof area/kWh/tariff → kWp and price; mechanical/B2B: spec sheet, MOQ, lead time, tiered pricing, PDF quote), quote versioning and approval.
5. **No eligibility/document workflow** for finance, study abroad, labor export (dossier: "điều kiện và tài liệu chính thức"). Opportunity: structured checklist, document upload with status, eligibility rules, consent/KYC-aware handoff.
6. **No menu / POS / loyalty integration** for restaurants (dossier: capacity, menu, points, offers). Opportunity: menu object with variants/availability, order-ahead, points lookup.
7. **Catalog is free-text, single-sourced to the bot, and not shared with the order module**; no variants, stock, promo conditions, or price validity (`12-cap-nhat-ket-luan.md` lesson 2). Opportunity: one product master with variants/stock/price rules feeding both AI answers and orders; retail (fashion, phone) is the vertical that most needs this.
8. **Industry parameters stop at the picker.** CRM statuses, tags, automation rules, order form, and bot settings are one fixed set. Opportunity: vertical packs that ship (a) slot schema, (b) seeded FAQ/scenarios with real placeholders to fill, (c) pipeline statuses and tag schemas, (d) workflow templates with industry-specific copy and conversion events, (e) industry KPI dashboards (show-up rate, booking rate, quote-to-order), not just message counts (dossier repeatedly: "đo kết quả cuối thay vì chỉ số tin nhắn").
9. **Conversion events are retail-only** (order created, Facebook purchase event). Services need "appointment confirmed / attended", education "enrolled", finance "application submitted" as first-class outcomes that stop follow-up and feed ad attribution.
10. **No public API/webhooks** for tenants to connect their own systems (PMS, LMS, dental software, CRM) — `02-san-pham/01-ban-do-tinh-nang.md` [CXN].
11. **Seed content quality.** Preny's seeds are generic non-answers ("hỗ trợ nhiều hình thức thanh toán thông dụng"). Opportunity: seeds with explicit `{{placeholders}}` (address, hours, payment methods, deposit policy) plus a guided fill-in step so the bot never ships vague answers.
12. **Human-role boundaries are prose only.** Dental/finance pages define what the bot must not decide; the product has one generic "needs human" tag. Opportunity: per-vertical guardrail prompts and escalation rules (clinical advice, credit decisions, legal/visa promises).
