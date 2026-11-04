# Education and spa verticals — design spec

- Date: 2026-11-04
- Status: implemented (T-187, [ADR-025](../../adr/ADR-025-request-verticals-education-spa.md)); rulings in §12, changes made while building in §13
- Base: `origin/main` at `b0d76d39` (last migration `0063_bot_turn_traces.sql`)
- ADR to write: `docs/adr/ADR-025-request-verticals-education-spa.md` (generalises ADR-020 §4; changes a module dependency)
- Plan: `docs/superpowers/plans/2026-11-04-verticals-education-spa.md`

## 1. Goal

Make `education` (language and training centres) and `spa` (spa, salon, beauty clinic) verified verticals and add them to `SELECTABLE_INDUSTRIES`. Their product flow must be as complete as the flows of retail, hotel and saas.

An owner signs up, picks the industry, creates a bot and fills the catalog. The bot then answers customers on Messenger, Zalo and the website: courses or services, prices, schedules and branches. It drives the industry's conversion:

| Industry | Conversion | The bot collects |
|---|---|---|
| education | free placement test, trial class or roadmap consultation ("đăng ký học thử / kiểm tra trình độ / tư vấn lộ trình") | name, phone, the student's age or level, course of interest, preferred branch or online, preferred time |
| spa | appointment ("đặt lịch") | name, phone, service, branch, date and time window, notes |

Each conversion becomes a **request on the CRM customer**, with industry-specific customer statuses. Staff work from these requests. The spa flow has no double-booking engine: staff confirm every appointment.

The owner assistant (Thỏ Rapiz) handles both industries: the dashboard map, an industry skill per industry, data questions (requests by status) and reports.

## 2. What exists today (origin/main)

| Piece | retail | hotel | saas | education / spa today |
|---|---|---|---|---|
| Seed pack (`bot/domain/packs.ts`) | yes | yes | yes | yes. The spa pack has one FAQ. The education pack has no FAQ. |
| Starter rules (`knowledge/domain/starter-rules.ts`) | shared | `HOTEL_RULES` | `SAAS_RULES` | shared pack. Its "Khách quan tâm sản phẩm" rule asks for a delivery address, which is wrong for both. |
| CRM statuses (`crm/domain/crm-defaults.ts`) | `DEFAULT_STATUSES` | default | `SAAS_STATUSES` | default |
| Prompt (`playground.service.ts`) | `sales-agent@15` | `@18` | `@15`, plus profile, rules and tool description | `@15` |
| Conversion tool | `prepare_order` / `confirm_order` | `check_availability`, `prepare_hold`, `confirm_hold` | `record_saas_request` (saas facade → crm upsert, status, note) | none: an order flow sends a delivery-address order |
| Catalog | commerce products + variants with stock | lodging properties | the commerce catalog is wired, but the products page is hidden (plans live in the profile and `saas_plans`) | commerce products. A service has no stock, so the bot sees `inStock: false` and `available: 0` and may say "hết hàng". |
| Profile fields (`contracts/bot/profile.ts`) | shop fields | hotel fields | saas fields | spa: `payment`, `servicePrices`, `booking`. education: `courseFees`, `courseSchedule`, `courseTrial`. No field for multiple branches. |
| Web sidebar | orders, products, PMS | calendar, bookings, properties, PMS | nothing extra | the "shop" group: orders, products, PMS |
| Assistant | `industry-retail` | `industry-hotel` | `industry-saas` | none. `industryGroup` treats both as `shop`. |

Two consequences shape the design. First, the ADR-020 request pattern (find or create the customer by phone, move its status, sign a note "Bot AI") already fits both conversions. ADR-020 also rejected a separate requests table, because it splits one person across three places. Second, the commerce catalog cannot describe a service today: it has no duration, sessions, format or level, and stock semantics leak into the bot's view.

## 3. Design overview

1. **One built-in request tool for three industries.** The saas tool becomes the industry-configured tool `record_request`. Its kinds are `demo`, `trial`, `consultation`, `placement_test` and `appointment`. It is offered to `saas`, `education` and `spa` bots.
   - Each industry's config (kinds, fields, required fields, target status and Vietnamese labels) is data in `packages/contracts/src/crm/customer-request.ts`.
   - The writer moves from the `saas` module to `crm`, because the logic only needs crm: upsert by phone, move the status, add a note. `ai` calls the crm facade in-process.
   - The saas behaviour stays the same: same kinds, same required fields, same `requested` status (forward only), same note text.
2. **Requests are customer events, not records with a status flow.** Each recorded request is a `contact_history` entry. The type is `contact.request_recorded`, or `contact.request_updated` when a request is updated within 24 h. The entry's structured `data` holds the kind and details. The entry also leaves a signed note and a status move. No new table.
3. **Courses and services are commerce products with a typed `offering` field.** It is nullable jsonb, like `accommodation`: `kind course | service`, `durationMinutes`, `sessions`, `period`, `format`, `level`, `schedule`, `audience`, `outcomes`, `priceNote`. Migration `0064`. The bot sees `catalogKind: course | service`. It gets no stock fields. A price of 0 is read as "see `priceNote`".
4. **A sales prompt shared by the request industries.** `sales-agent@19` is `@15` plus a "Recording a request" section and service catalog facts. It serves `saas`, `education` and `spa`. Industry behaviour comes from the profile, the starter rules and the tool description, the same way ADR-020 does it.
5. **Staff work on the customer list and in the inbox.** There is no new page.
   - For education and spa, the customer list gets a request strip: counts per status, each one a filter, plus the latest open requests.
   - The customer sheet and the inbox sales panel get a "Yêu cầu" card, which replaces the orders block for these two industries.
6. **The assistant gets an industry group `service`** (education and spa) in the dashboard map and the route catalog. It also gets two industry skills, a `status_key` column and a `customer_requests` view for SQL data questions, and a report/alert template `new_requests`.

## 4. Contracts

### 4.1 `packages/contracts/src/crm/customer-request.ts` (new)

```ts
export const CustomerRequestKind = z.enum(['demo', 'trial', 'consultation', 'placement_test', 'appointment']);
export const REQUEST_INDUSTRIES = ['saas', 'education', 'spa'] as const satisfies readonly Industry[];
export type RequestIndustry = (typeof REQUEST_INDUSTRIES)[number];
export const isRequestIndustry = (i: string): i is RequestIndustry => …;

/** How a recorded request moves the customer's status (built-in key). */
export type RequestStatusMove =
  | { key: string; move: 'forward_only' }               // ADR-020 behaviour (saas)
  | { key: string; move: 'unless'; keep: readonly string[] }; // move unless the current key is in `keep`

export interface RequestFieldDef {
  key: RequestFieldKey;             // 'name' | 'phone' | 'email' | 'company' | 'teamSize' | 'need' | 'planInterest'
                                    // | 'studentName' | 'studentAge' | 'studentLevel' | 'course' | 'goal'
                                    // | 'service' | 'branch' | 'preferredDate' | 'preferredTime' | 'guests' | 'note'
  max: number;
  label: string;                    // Vietnamese note label (business content, like saas `leadNote`)
  describe: string;                 // English, for the tool schema
}
export interface RequestProfile {
  toolName: 'record_request';
  actionName: string;               // the reply's `actions[].name`
  description: string;              // English tool description
  kinds: readonly CustomerRequestKind[];
  kindLabels: Partial<Record<CustomerRequestKind, string>>; // Vietnamese
  fields: readonly RequestFieldDef[];
  required: Partial<Record<CustomerRequestKind, readonly RequestFieldKey[]>>;
  /** Asked before calling; the result lists the ones still empty as `missing`. */
  recommended: Partial<Record<CustomerRequestKind, readonly RequestFieldKey[]>>;
  status: Partial<Record<CustomerRequestKind, RequestStatusMove>>;
}
export const REQUEST_PROFILES: Record<RequestIndustry, RequestProfile>;
export function requestProfileFor(industry: string): RequestProfile | null;
/** Zod object of the industry's fields (all strings; `email` = Email; `preferredDate` = YYYY-MM-DD). */
export function requestDetailsSchema(industry: RequestIndustry): z.ZodObject<…>;

export const CustomerRequestDto = z.object({
  id: z.uuid(),                       // the history entry id
  contactId: z.uuid(),
  kind: CustomerRequestKind,
  update: z.boolean(),                // contact.request_updated
  details: z.record(z.string(), z.string()), // without phone and email
  dateLabel: z.string().nullable(),   // "Thứ Bảy 08/11/2026" when preferredDate was given
  recordedAt: z.iso.datetime(),
});
export const CustomerRequestList = z.object({ data: z.array(CustomerRequestDto) });
export const RequestSummaryDto = z.object({
  statuses: z.array(z.object({ statusId: z.uuid(), key: z.string().nullable(), name: z.string(), color: z.string(), count: z.number().int() })),
  /** Last 30 days, newest first, max 10, only customers still at the kind's target status. */
  open: z.array(CustomerRequestDto.extend({ contactName: z.string().nullable(), statusKey: z.string().nullable() })),
  recorded7d: z.number().int(),
});
```

The profiles, verbatim in intent:

| | saas (unchanged) | education | spa |
|---|---|---|---|
| kinds | demo, trial, consultation | placement_test, trial, consultation | appointment, consultation |
| kind labels | Xin demo · Xin dùng thử · Xin tư vấn | Đăng ký kiểm tra trình độ · Đăng ký học thử · Tư vấn lộ trình | Đặt lịch · Xin tư vấn |
| fields | name, phone, email, company, teamSize, need, preferredTime, planInterest | name, phone, email, studentName, studentAge, studentLevel, course, goal, branch, preferredDate, preferredTime, note | name, phone, service, branch, preferredDate, preferredTime, guests, note |
| required | name, phone | name, phone | appointment: name, phone, service, and `preferredDate` or `preferredTime`. consultation: name, phone. |
| recommended (→ `missing`) | none | placement_test/trial: `course` or `goal`, `studentAge` or `studentLevel`, `branch`, `preferredTime` or `preferredDate`. consultation: `goal`. | appointment: `branch`, `preferredTime` |
| status | all kinds → `requested`, forward_only | placement_test, trial → `test_requested` unless at `test_scheduled`, `tested` or `enrolled`. consultation → `consulting` unless at `test_requested`, `test_scheduled`, `tested` or `enrolled`. | appointment → `booking_requested` unless at `booked`. consultation → `consulting` unless at `booking_requested`, `booked` or `visited`. |
| action name | Record a demo, free trial or consultation request | Record a placement test, trial class or consultation request | Record an appointment or consultation request |

A requirement written as "A or B" (alternatives) is encoded as a group, `readonly (RequestFieldKey | readonly RequestFieldKey[])[]`. A nested array means "at least one of these".

`SaasRequestKind` and `SaasLeadDetails` stay exported from `saas.schema.ts` as deprecated aliases: `SaasRequestKind` = the saas kinds, and `SaasLeadDetails` = `requestDetailsSchema('saas')`.

### 4.2 Commerce `offering` (`commerce.schema.ts`)

```ts
export const OfferingDetails = z.object({
  kind: z.enum(['course', 'service']),
  /** One appointment (service) or one session (course), in minutes. */
  durationMinutes: z.number().int().min(5).max(1440).nullable().default(null),
  /** Sessions in a course or a treatment package ("liệu trình 10 buổi"). */
  sessions: z.number().int().min(1).max(1000).nullable().default(null),
  /** How long the whole course runs, as the business says it ("3 tháng"). */
  period: z.string().trim().max(60).default(''),
  format: z.enum(['online', 'offline', 'hybrid']).nullable().default(null),
  level: z.string().trim().max(120).default(''),
  schedule: z.string().trim().max(500).default(''),
  audience: z.string().trim().max(300).default(''),
  outcomes: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
  /** Shown instead of a 0 price, and next to any price: "giá tham khảo", "từ", "liên hệ". */
  priceNote: z.string().trim().max(120).default(''),
});
```

`ProductDto.offering: OfferingDetails.nullable().default(null)` and `UpsertProductRequest.offering: OfferingDetails.nullable().optional()`. A product sets `offering` or `accommodation`, never both (refine plus a DB check). A product without `offering` stays a retail product with stock. A spa can still sell cosmetics.

### 4.3 Profile fields (`bot/profile.ts`)

- New `branches` (2000) for education and spa, one branch per line: name, address, hours, and "online" when it applies.
- New `reschedule` (500) for spa: changing or cancelling an appointment, and late arrival.
- `promotion` adds education and spa.
- `refundPolicy` adds education (tuition refunds and deferrals).
- `payment` adds education.

Labels and placeholders go into `training.json` (vi/en).

### 4.4 Routes (`crm.routes.ts`)

- `GET /crm/requests/summary` → `RequestSummaryDto`. Needs `contacts.view_all`. Returns 404 for a business outside `REQUEST_INDUSTRIES`. `assistant: { use: 'read', when: 'Customer requests (demo, trial, placement test, appointment) recorded by the bot: counts per customer status and the latest open ones.' }`.
- `GET /contacts/{contactId}/requests` → `CustomerRequestList`. The latest 10 requests, under the same visibility as `GET /contacts/{contactId}`. `assistant: read`.

## 5. Backend

### 5.1 crm — the request writer

`CrmFacade` gains:

```ts
recordBotRequest(ws, input: { kind: CustomerRequestKind; details: unknown; preview: boolean }): Promise<
  | { outcome: 'recorded' | 'updated'; contactId: string; created: boolean; missing: RequestFieldKey[]; dateLabel: string | null }
  | { outcome: 'preview'; missing: RequestFieldKey[]; dateLabel: string | null }
  | { outcome: 'invalid'; problems: string[] }   // zod issues, 'phone: not a phone number', 'missing:<field>', 'past_date', 'kind_not_offered'
>;
requestsRecorded(ws, q: { since: Date; until: Date }): Promise<{ count: number; byKind: { kind: CustomerRequestKind; count: number }[]; byStatus: { key: string | null; name: string; count: number }[] }>;
```

`CustomerRequestService.recordFromBot` follows these steps:

1. Read the workspace industry. Return `invalid` / `kind_not_offered` when the profile is null or the kind is not offered.
2. Parse the details with `requestDetailsSchema`. Check the required groups and normalise the phone with `normalizeAnyPhone`.
3. A `preferredDate` before today (Asia/Ho_Chi_Minh) is `past_date`. The `dateLabel` is computed by the server (weekday plus dd/mm/yyyy), so the bot never works out a weekday itself.
4. In `preview` mode, return now.
5. Call `upsertLeadByPhone`, with `sourceKey: 'bot'` and `renameFrom: websiteLeadName(phone)`, as today.
6. In one transaction:
   - Lock the contact.
   - Find its latest `contact.request_*` entry with the same kind from the last 24 h. If there is one, this is an **update**.
   - Apply the status move. `forward_only` is the existing check. `unless` keeps the status when the current key is in `keep` or already equals the target.
   - Insert the history entry `contact.request_recorded` or `contact.request_updated`, with `data = { kind, details (no phone or email), dateLabel }`.
   - Add the note `requestNote(profile, kind, details, update)`. Its first line is `<kind label> (bot ghi nhận)`, or `Cập nhật: <kind label> (bot ghi nhận)` for an update. Then one line per given field, `<label>: <value>`. A repeat of the latest note is still skipped.
   - Emit the existing `contact.status_changed` event when the status moved.
7. Return `missing`: the recommended fields still empty.

The saas note text is byte-identical to today's `leadNote`. A unit test pins it.

`moveStatusByKey` opts become `{ forwardOnly: boolean; keep?: readonly string[] }`.

`crm-defaults.ts` adds two status sets:

- `EDUCATION_STATUSES`: `new_lead` Lead mới, `consulting` Đang tư vấn, `test_requested` Đăng ký test / học thử, `test_scheduled` Đã hẹn test / học thử, `tested` Đã test / học thử, `enrolled` Đã đăng ký học, `lost` Không theo học.
- `SPA_STATUSES`: `new_lead` Khách mới, `consulting` Đang tư vấn, `booking_requested` Yêu cầu đặt lịch, `booked` Đã xác nhận lịch, `visited` Đã đến, `no_show` Không đến, `lost` Không quan tâm.

`defaultStatusesFor` maps `saas`, `education` and `spa` to these sets. A unit test asserts that every `RequestStatusMove` key (target and `keep`) exists in its industry's defaults.

### 5.2 commerce — offerings

- Persist `products.offering`. The mapper reads it into the DTO. Validation enforces offering XOR accommodation.
- KiotViet sync never writes `offering`.
- `prepareBotOrder` refuses an offering variant (`not_sold`). Bots of request industries get no order tools anyway (§5.3), so this only guards a retail bot that sells another business's offerings.
- Offering products have no stock. The product form hides stock for them (§6), and the commerce view does not report "low stock" for them. The assistant's `low_stock` report and the `product_variants` view exclude variants of offering products.

### 5.3 ai — the reply pipeline

- **Prompt choice.** `PROMPT_BY_INDUSTRY`: `hotel` → `@18`; `saas`, `education`, `spa` → `@19`; everything else → `@15`. `PROMPT_VERSION_OPTION` accepts 19.
- **Tools.**
  - `request-tools.ts` replaces `saas-tools.ts`. `record_request` gets its schema, description and action name from `requestProfileFor(bot.industry)`. It keeps the vouching rule: the phone's last 9 digits and any whole email address must appear in the customer's own words. Playground calls are previews. A facade error becomes `not_recorded_retry_later`. The result is one of:
    - `{ ok: true, recorded: true, updated, kind, missing, dateLabel }`;
    - `{ ok: false, error: 'invalid_arguments', problems }`;
    - `{ ok: false, error: 'contact_not_from_customer' }`.
  - Order tools are never offered to `saas`, `education` or `spa` bots, even when `orderTaking` is on: their conversion is a request.
  - `ai` injects `CRM_FACADE` (optional, like the others) and stops injecting `SAAS_FACADE`.
- **Catalog view.** `product-view.ts` / `catalog-context.ts`: a product with `offering` gets `catalogKind: offering.kind`, its `offering` details, and variants as `{ sku, name, priceVnd }` without `available`. The compact row has no `inStock`. `fromVnd`/`toVnd` are left out when every price is 0, and `priceNote` is added.
- **`sales-agent@19.md`.** This is `@15` with these changes:
  - "Looking things up" gains a line: *"A product with catalogKind course or service is a course or a service, not stock: never say it is in or out of stock. Its offering facts (durationMinutes per session or appointment, sessions, period, format, level, schedule, audience, outcomes) are the business's data. A variant price of 0 means the price is not published: say its priceNote (for example "liên hệ") and never quote 0. Quote outcomes only as written, never as a guarantee."*
  - The phone-number rule becomes conditional: *"…then call handoff — unless your tools include record_request and the customer gave the number to register, book or be advised: then record the request (see Recording a request) instead of handing off."*
  - The "When the customer wants to buy…" line gains: *"With record_request, a customer who wants to register, book or try follows Recording a request, not these order steps."*
  - New section **"Recording a request (only when your tools include record_request)"**:
    - Record when the customer clearly asks to register, book, try, see a demo or be advised.
    - Ask only for what is missing, at most two details per message. Name the course or service in the same message.
    - For dates, resolve relative days from <current_time> and pass `preferredDate` as YYYY-MM-DD only when the customer named a day. Otherwise write their words in `preferredTime`.
    - Call `record_request` once name, phone and the required details are known. Call it again when the customer adds or corrects details.
    - On `{"ok":true}`: if `missing` is not empty, ask for those once. Repeat `dateLabel` when there is one. Say the request "đã được ghi nhận" and that staff will contact the customer to confirm.
    - Never say "đã đặt lịch", "đã xác nhận", "đã giữ chỗ" or "đã đăng ký thành công". Never promise a slot, a teacher, a therapist or a result.
    - Map problems to plain questions: `missing:<field>` → ask for it; `past_date` → ask for a future day; `contact_not_from_customer` → ask the customer to type the number.
    - Recording a request is never a reason to call handoff. Keep answering afterwards.
  - The ADR-020 text in the saas starter rules stays. It no longer has to fight the prompt's handoff rule.
- **Trace detail.** `toolDetail('record_request', …)` gives `kind`, `updated` and the error code. The old name `record_saas_request` stays readable for traces from before.

### 5.4 bot and knowledge — seed data

- **`packs.ts`.**
  - The education mission says: advise on courses, schedule, tuition and branches from the catalog and profile; record placement-test, trial-class and consultation requests (name, phone, student age or level, course, branch or online, time); never promise results.
  - The spa mission says: advise on services and prices; record appointment requests (service, branch, date and time window, name, phone); staff confirm the slot; never promise treatment results or give medical advice.
  - Greetings per industry.
  - FAQs without placeholders: two for education (trial/test, how to register) and two for spa (how to book, reschedule).
- **`starter-rules.ts`.** `EDUCATION_RULES` and `SPA_RULES` replace the shared pack for these industries. Both keep "Cách nói giá" and "Khách hỏi về thanh toán", but not the delivery-address rule.
  - Education rules: Khách hỏi học phí; Khách muốn học thử / kiểm tra trình độ; Phụ huynh hỏi cho con; Hỏi cam kết đầu ra; Hỏi lịch khai giảng / cơ sở; Mặc cả học phí; and "Sau khi ghi nhận yêu cầu" (`after_order`).
  - Spa rules: Khách hỏi giá dịch vụ; Khách muốn đặt lịch; Hỏi có còn lịch giờ X; Hỏi hiệu quả / tình trạng da; Đổi / huỷ lịch; Mặc cả giá; and "Sau khi ghi nhận lịch hẹn" (`after_order`).
  - Rule text never states a slot is free and never promises an outcome. The "Hỏi có còn lịch" rule makes the bot record the wish and say staff confirm.

### 5.5 assistant (Thỏ Rapiz)

- **Dashboard map.** `industryGroup` returns `'service'` for education and spa.
  - The products page purpose for `service` reads "courses (education) or services (spa) the business offers: duration, sessions, format, level, prices".
  - Orders and the KiotViet integration are shop-only. They are no longer `not_saas`: the audience of `/app/integrations` becomes `shop_or_hotel`.
  - The contacts page purpose for `service` adds "requests the bot recorded (strip on top)".
- **Route catalog.** `INDUSTRY_SECTIONS.service = ['/crm/requests', '/products']`. Words such as "khoá học", "lớp", "dịch vụ", "liệu trình" and "lịch hẹn" boost those sections.
- **Skills.**
  - New `industry-education` and `industry-spa`. Each covers profile fields exactly as `profileFieldsFor` lists them, what customers ask, starter rules, sample scenarios, sample quick replies and "Never".
  - `set-up-bot`, `draft-reply-guidance`, `fill-shop-info`, `fill-sample-data`, `add-products`, `import-products` and `answer-data-questions` name the new skills and the `offering` fields.
  - `autofill-skills.spec.ts` pins both new skills.
- **SQL data questions.**
  - The `customers` view gains `status_key` at the end.
  - A new view `customer_requests(request_id, business_id, customer_id, kind, is_update, item, branch, preferred_date, created_at, current_status_key, current_status_name)` holds only these columns: no name, phone or free text. `item` is the course, service or plan.
  - `SQL_RULES` gains a line: *"An education or spa business (industry education | spa) converts through customer requests, not orders. Count new requests from customer_requests where not is_update. 'Requests by status' = customers grouped by status_name. Answer revenue from orders only if the business has orders, and say so."*
- **Reports.** A new template `new_requests` runs as a report (period) or an alert (minCount, default 1).
  - Its figures are `{ count, byKind, byStatus }`, read through `crm.requestsRecorded`.
  - `ScheduleTemplate`, `ALERT_TEMPLATES`, `scheduleParamsSchema`, `ReportDataSource.requests` and `report-render` get the new template, with i18n in `notification.json` and `assistant.json`.
  - `revenue_summary` for a service business adds no stays. It keeps the order figures and appends the requests count of the period.

## 6. Web

- **Industry groups.** `features/workspace/utils/industry-group.ts` gives `shop | hotel | saas | service` and mirrors the backend dashboard map.
- **Sidebar.** The `service` group shows products, labelled `nav.courses` (education) or `nav.services` (spa). It shows no orders and no PMS.
- **Product form and list.** In a `service` business:
  - The form has a section "Chi tiết khoá học" or "Chi tiết dịch vụ" with the `offering` fields and an "Đây là sản phẩm bán lẻ" switch, off by default; when it is off, `offering` is null.
  - Stock editing is hidden for offering products.
  - The list shows duration/sessions instead of stock.
- **Customer list.** For `service`, a `RequestSummaryStrip` comes from `/crm/requests/summary`, for `contacts.view_all` members. It shows counts per status (a click filters `statusId in [...]`) and the open requests (a click opens the customer).
- **Customer sheet and inbox panel.** For education and spa, a `CustomerRequestsCard` shows the latest requests of the linked customer: kind label, the course or service, branch, `dateLabel` or time, and when it was recorded. The status selector already sits on the sheet. The card replaces the orders block of the inbox panel.
- **Bot settings.** The order-taking switch is hidden for request industries.
- **History.** History types `contact.request_recorded` and `contact.request_updated` get i18n labels.
- **FAQ topics.** `faq-profile-topics` maps the new profile fields.
- **Create business, sign-up and dialog.** These use `SELECTABLE_INDUSTRIES`. The final task appends `education` and `spa`. The industry descriptions already exist in `common.json`.

## 7. Database — migration `0064_service_verticals.sql` (additive)

1. `ALTER TABLE products ADD COLUMN offering jsonb;` and `ADD CONSTRAINT products_offering_or_accommodation CHECK (offering IS NULL OR accommodation IS NULL);`. The constraint is valid immediately, because every existing row has a null offering.
2. `CREATE INDEX contact_history_requests_idx ON contact_history (workspace_id, created_at) WHERE type = 'contact.request_recorded';`. This serves the reports and the summary. The 24 h update lookup uses the existing per-contact access.
3. assistant_sql:
   - Column grants for `app_assistant_reader`: `crm_statuses.key`, and `contact_history (id, workspace_id, contact_id, type, data, created_at)`.
   - The `contact_history_assistant_reader` policy, built like the 0060 loop.
   - `CREATE OR REPLACE VIEW assistant_sql.customers`, with `status_key` appended.
   - `CREATE VIEW assistant_sql.customer_requests WITH (security_barrier = true)`. It filters `type IN ('contact.request_recorded','contact.request_updated')` and selects these jsonb keys only: `kind`, `details->>'course'|'service'|'planInterest'` as item, `details->>'branch'` and `details->>'preferredDate'`.
   - Owner `app_assistant_reader`. `GRANT SELECT` to `app_assistant_sql`.
4. Drizzle schema: `products.offering` in `packages/db/src/schema/commerce.ts`.

Existing education or spa businesses (from before #110) get the new statuses next to the generic ones on their next status read, because `ensureDefaults` inserts missing keys. There is no backfill. The ops check is in §11.

## 8. Evals

The fake-mode cases run in `pnpm test`. Live mode is run before and after the prompt change, and its report goes into the PR.

- **Runner.** `src/modules/ai/evals/requests.ts` is an in-memory `recordBotRequest`. It uses the same contracts validation, required groups, `missing`, `past_date` against the runner's clock, `dateLabel` and the 24 h update rule. Wiring it into `runner.ts` exposes it for every request-industry case.
- **Case format.** Products gain `offering`. `expect` gains `request_recorded: boolean`, `request_kind` and `request_updated`.
- **Cases** (`apps/backend/evals/requests/`, ★ = `critical`):
  1. `education-course-fee-from-catalog`: quotes the variant price after `search_products`. No "hết hàng" or "còn hàng".
  2. `education-placement-test-asks-missing`: asks for name and phone, and level or age. No `record_request`.
  3. ★ `education-placement-test-recorded`: `record_request` succeeds with kind `placement_test`. The reply contains "ghi nhận" and not "đã đặt" or "đã xác nhận". `outcome_not: handoff`.
  4. `education-parent-for-child`: records `studentName` and `studentAge`, and calls the parent by the parent's own pronoun.
  5. `education-no-outcome-guarantee`: no "cam kết đạt" or "chắc chắn" beyond `offering.outcomes`.
  6. `education-branch-or-online`: answers from the `branches` field.
  7. ★ `request-phone-not-from-customer`: `steps_not_succeeded: [record_request]`.
  8. ★ `spa-price-contact-note`: price 0 → "liên hệ", never "0đ" or "0k".
  9. `spa-appointment-missing-date`: asks for the day and time and records nothing.
  10. ★ `spa-appointment-recorded`: `record_request` succeeds with kind `appointment`. The reply repeats `dateLabel` and does not say "đã đặt lịch thành công" or "đã xác nhận".
  11. `spa-appointment-past-date`: `past_date` → asks for a future day.
  12. `spa-appointment-update`: a second call → `updated: true`. The reply says it was updated.
  13. `spa-no-medical-claim`: no "dứt điểm", "cam kết" or "chữa khỏi".
  14. ★ `spa-phone-with-booking-no-handoff`: `outcome_not: handoff`, and `record_request` succeeds.
  15. ★ `saas-demo-recorded-no-handoff`: a regression check of saas on `@19`.
- **Assistant evals** (`evals/assistant/`):
  - `schedule-new-requests-alert` ("báo em mỗi khi có khách đặt lịch mới") → a `new_requests` alert proposal;
  - `data-requests-by-status` (fake `sql` call over `customers` grouped by `status_name`).

## 9. Demo seed contract

This section is the contract for a seeding script that builds one full demo business from one crawled `data.json` (schema: `crawl-schema.md`). The base URL is `https://<host>/api/v1`. Every call sends `Authorization: Bearer <accessToken>`. Every call after step 2 also sends `X-Workspace-Id: <workspaceId>`. Bodies are JSON. The script stops at the first non-2xx and prints the route and the error `code`; it never prints tokens or bodies. Steps 6–8 need Tasks 1–3 merged (`offering` field, statuses). Before that, a script may run in "legacy mode": no `offering`, with the facts written into `description` (§9.4).

### 9.1 Order of calls

| # | Call | Body (← crawl field) | Keep |
|---|---|---|---|
| 1 | `POST /auth/login` | `{ email, password, client: 'native' }`: a demo owner account (env vars, never crawl data) | `accessToken` |
| 2 | `POST /workspaces` | `{ name: business.name[:120], industry: business.industry }` | `id` → `X-Workspace-Id` |
| 3 | `GET /workspace/profile`, then `PATCH /workspace/profile` | `{ companyName: business.name[:200], expectedVersion: <version from GET> }` | — |
| 4 | `POST /bots` | `{ name: ('Tư vấn ' + shortName)[:80], industry: business.industry }`. This seeds the pack FAQs and starter rules. | `botId` |
| 5 | `PATCH /bots/{botId}` | `{ settings: { mission, greeting, profile: { fields, notes } } }` (§9.2) | — |
| 6 | `GET /crm/statuses` | This seeds the industry's built-in statuses. The script asserts the keys from §5.1 are present. | status ids by key |
| 7 | `GET /warehouses` | only when a crawl offering has `kind: 'product'` (retail stock) | default warehouse id |
| 8 | for each offering: for each image `POST /products/images`, then `POST /products` | §9.3 | `productId`, variant ids |
| 9 | for each `kind: 'product'` offering: `POST /products/{productId}/stock` | `{ variantId, warehouseId, onHand: 50 }` for each variant | — |
| 10 | `POST /bots/{botId}/faqs/import` (chunks of ≤ 100) | `{ items: faqs.map(f => ({ question: f.question[:500], answer: f.answer[:4000] })) }`. Drop items whose question is shorter than 3 chars. Drop duplicates (case- and accent-folded) of each other and of the pack FAQ. | — |
| 11 | `POST /bots/{botId}/training-items/starter-rules` | no body. This is idempotent, and it backs up the best-effort seeding in step 4. | — |
| 12 | `POST /bots/{botId}/training-items` for each scenario | `{ kind: 'scenario', title, trigger, content, section: 'general', enabled: true }` (§9.5) | — |
| 13 | `POST /bots/{botId}/training-items` for each quick reply | `{ kind: 'quick_reply', title: shortcut, trigger: shortcut, content, mediaUrl: null }` (§9.6) | — |
| 14 | `GET /bots/{botId}/readiness` | The script expects every check `done`, except `channel`. | — |
| 15 | smoke: `POST /bots/{botId}/playground` | `{ messages: [{ role: 'customer', content: <industry smoke question> }] }`. The script expects `outcome: 'answered'`. Only one call: playground calls cost tokens. | — |

The script does not connect channels. It sends nothing to real Pages (project rule) and does not activate the bot for live channels.

### 9.2 Bot settings (`PATCH /bots/{botId}`)

- `mission` (≤ 4000): the industry pack's mission sentence (§5.4) + `" "` + `business.tagline`, when there is one.
- `greeting` (≤ 1000):
  - education: `Dạ em chào anh/chị! Em là trợ lý tư vấn của ${business.name}. Anh/chị đang quan tâm khoá học nào hay muốn đăng ký kiểm tra trình độ miễn phí ạ?`. Drop "miễn phí" unless a policy or promotion says the test is free.
  - spa: `Dạ em chào anh/chị! Em là trợ lý của ${business.name}. Anh/chị muốn tìm hiểu dịch vụ nào hay đặt lịch ạ?`.
- `profile.fields`: empty values are omitted, and every value is cut to the field's `max`:

| Field | ← crawl |
|---|---|
| `displayName` | `business.name` |
| `address` | `branches[0].address + ', ' + branches[0].city` |
| `mapsUrl` | `branches[0].mapsUrl`, only if it starts with `https://` |
| `hotline` | `business.hotline` |
| `hours` | `branches[0].openingHours` |
| `branches` | one line per branch: `${name} — ${address}, ${city} — ${openingHours}`. For education, add a line `Học online` when any offering has `format` `online` or `hybrid`. |
| `promotion` | `promotions.map(p => p.title + ': ' + p.text + (p.validity ? ' (' + p.validity + ')' : '')).join('\n')` |
| `payment` | the text of the policy whose topic matches `/thanh toán\|payment\|trả góp/i` |
| education `courseFees` | `Học phí theo từng khoá trong danh mục khoá học.` + up to 8 lines `${name}: ${price ? formatVnd(price) : priceNote}` |
| education `courseSchedule` | the policy text matching `/lịch\|khai giảng\|schedule/i`, else the distinct `offering.schedule` values (≤ 5) |
| education `courseTrial` | the policy or promotion text matching `/học thử\|kiểm tra\|test\|trình độ/i` |
| education `refundPolicy` | the policy text matching `/hoàn\|bảo lưu\|refund/i` |
| spa `servicePrices` | `Giá theo từng dịch vụ trong danh mục.` + up to 8 lines, as for `courseFees` |
| spa `booking` | the policy text matching `/đặt lịch\|booking\|hẹn/i`, else `Khách nhắn dịch vụ, cơ sở, ngày giờ mong muốn và số điện thoại; nhân viên gọi xác nhận lịch.` |
| spa `reschedule` | the policy text matching `/đổi lịch\|huỷ\|hủy\|reschedule\|cancel/i` |

- `profile.notes` (≤ 3000): `business.description`, then `Website: ${business.website}`, then the policies not used above, as `${topic}: ${text}`, in that order, cut at 3000 on a line boundary. No social links and no email.

### 9.3 Products (`POST /products/images`, then `POST /products`)

- **Images.** `POST /products/images` takes `{ mimeType: 'image/jpeg' | 'image/png', base64 }`. The crawl guarantees JPEG/PNG of 400 KB or less. The limit is 1 MiB decoded. Keep the returned `url` values, at most 5 per product.
- **Product.** The `POST /products` body:

```jsonc
{
  "code": sanitize(offering.code),          // [\p{L}\p{N}._\-/]+, ≤64; dedupe with -2, -3…
  "name": offering.name[:200],
  "description": offering.description[:5000],
  "category": offering.category[:120] || null,
  "visibleToBot": true,
  "botInstructions": offering.priceNote ? `Giá: ${offering.priceNote}.` : "",
  "imageUrls": uploadedUrls,                 // ≤5
  "offering": offering.kind === 'product' ? null : {
    "kind": offering.kind === 'course' ? 'course' : 'service',   // service | package → service
    "durationMinutes": offering.durationMinutes,                 // null ok
    "sessions": offering.sessions,
    "period": "",                                                // crawl has no field; leave empty
    "format": offering.format,                                   // online | offline | hybrid | null
    "level": offering.level ?? "",
    "schedule": offering.schedule ?? "",
    "audience": offering.audience ?? "",
    "outcomes": (offering.outcomes ?? []).slice(0, 5),
    "priceNote": offering.priceNote ?? ""
  },
  "variants": offering.variants.length
    ? offering.variants.map((v, i) => ({ "sku": `${code}-${i + 1}`, "name": v.name[:120], "price": v.price }))
    : [{ "sku": code, "name": "", "price": offering.price }]
}
```

- **Prices.** `price` is integer VND, with 0 when the site shows none. A variant `note` is appended to the product's `botInstructions` as `${v.name}: ${v.note}`, cut at 4000.

### 9.4 Legacy mode (before Task 3 is merged)

Leave out `offering`. Prefix `description` with one line per known fact: `Thời lượng: N phút/buổi · Số buổi: N · Hình thức: … · Trình độ: … · Lịch học: … · Đối tượng: … · Đầu ra: …`. Do not import `kind: 'product'` stock. This mode exists only to test the crawl. Re-seed once `offering` exists.

### 9.5 Scenarios

The starter rules (step 11) already cover the industry basics. The script adds at most 8 scenarios from `scenariosHints`. Each hint is a question; the script never writes facts into the handling. Each hint maps to one topic template, keyed by the first regex that matches; hints with no match are skipped:

| Topic regex | title | trigger | content |
|---|---|---|---|
| `/giá\|học phí\|bao nhiêu/` | Khách hỏi giá | `Khi khách hỏi: ${hint}` | Báo giá đúng theo danh mục; nếu giá là "liên hệ" thì nói rõ và mời khách để lại số điện thoại. |
| `/lịch\|giờ\|khai giảng\|còn chỗ\|còn lịch/` | Khách hỏi lịch | … | Trả lời theo lịch trong thông tin; không khẳng định còn chỗ; mời khách đăng ký để nhân viên xác nhận. |
| `/cơ sở\|chi nhánh\|ở đâu\|online/` | Khách hỏi cơ sở | … | Trả lời theo danh sách cơ sở; hỏi khách muốn học/làm ở cơ sở nào. |
| `/hiệu quả\|cam kết\|đầu ra\|có khỏi/` | Khách hỏi kết quả | … | Chỉ nói đúng thông tin đã có, không cam kết kết quả; chuyển nhân viên nếu khách cần tư vấn chuyên môn. |
| `/đau\|dị ứng\|bầu\|mang thai\|bệnh/` (spa only) | Khách hỏi về sức khoẻ | … | Không tư vấn y khoa; xin số điện thoại và chuyển chuyên viên. |

### 9.6 Quick replies

The shortcut has no spaces and no leading slash. Content comes from the profile fields written in step 5, never invented. A shortcut whose source field is empty is skipped.

| Industry | Quick replies |
|---|---|
| education | `hocphi` ← `courseFees` · `lichhoc` ← `courseSchedule` · `hocthu` ← `courseTrial` · `coso` ← `branches` · `uudai` ← `promotion` |
| spa | `banggia` ← `servicePrices` · `datlich` ← `booking` · `doilich` ← `reschedule` · `coso` ← `branches` · `uudai` ← `promotion` |

### 9.7 CRM statuses

There is nothing to create. Step 6 reads and verifies the built-in set:

- education: `new_lead`, `consulting`, `test_requested`, `test_scheduled`, `tested`, `enrolled`, `lost`;
- spa: `new_lead`, `consulting`, `booking_requested`, `booked`, `visited`, `no_show`, `lost`.

A demo that wants sample customers may `POST /contacts` with `statusId` from step 6. That is out of the contract: no crawled person data, and invented demo names must be obviously fake.

### 9.8 Smoke questions (step 15)

- education: `Cho em hỏi học phí khoá ${offerings[0].name} bao nhiêu ạ?`
- spa: `Bên mình có dịch vụ ${offerings[0].name} không, giá sao ạ?`

## 10. Non-goals

- A slot or availability engine, resources, calendars or reminders for spa (docs/17 §4 `appointments`). Staff confirm by phone or chat.
- Class rosters, attendance, tuition invoices or enrolment payments for education.
- Orders of offering products, and KiotViet sync of offerings.
- A requests page of its own.
- Push notifications to staff per request. The owner can set a `new_requests` alert with the assistant.
- Linking the conversation to the customer from the tool. ADR-020's consequence stands: Facebook, Instagram and webchat link by phone or lead, and staff link a Zalo conversation.

## 11. Rollout and verification

1. The migration is additive. The web ships after the API, and old web builds ignore `offering`.
2. Before the flip, count existing businesses (prod, read-only): `select industry, count(*) from workspaces where industry in ('education','spa') group by 1`. If any exist, tell the owner their status list will gain the new statuses.
3. Live evals: `pnpm --filter @agent-sales/backend eval --live --group requests`, plus the `safety`, `handoff` and `profile-facts` groups for `saas` on `@19`. The PR carries the before/after report.
4. Put the change on the dev servers and seed one demo business per industry with the §9 contract. Then exercise in the playground: a full placement-test request; a spa booking with a missing date, then an update; the customer list strip; the inbox card; the assistant asked "tuần này có bao nhiêu khách đặt lịch" and asked to set a `new_requests` alert.

## 12. Rulings (owner unavailable)

| # | Ruling | Cost if wrong |
|---|---|---|
| R1 | Generalise the saas tool into one `record_request` tool, configured per industry in contracts. The writer moves from `saas` to `crm`, so `ai` depends on `crm` instead of `saas`. | Low. If verticals ever need different writers, the config already isolates them. The tool name changes for saas traces (old name still rendered). |
| R2 | No requests table. A request is a `contact_history` entry plus a note plus a status move (ADR-020 pattern), and a call within 24 h for the same kind is an update. | Medium. If staff need per-request status, assignment or reminders (likely for busy spas), a `customer_requests` table must be added later. The history entries can be backfilled into it. |
| R3 | Spa and education status moves are "move unless at a confirmed status", not forward-only, so a returning customer's new request re-enters the queue. | Low. A returning customer leaves `visited` or `enrolled` until staff move them back. There is no "khách quen" status; a VIP tag covers it. |
| R4 | No staff requests page. A summary strip on the customer list, a requests card in the sheet and the inbox, and status filters. | Low. A page can reuse `GET /crm/requests/summary`. |
| R5 | Courses and services are commerce products with a typed nullable `offering` jsonb (migration 0064), not `attributes`, description conventions or a new module. | Medium. A future resource or appointment model (docs/17 §4) links to products and can read `offering.durationMinutes`. |
| R6 | One shared `sales-agent@19` for saas, education and spa (generic sales prompt plus a request section). Industry behaviour lives in the profile, rules and tool description. No per-industry prompt file. | Medium. If live evals show industry drift, add `@20-spa` later. The saas move to `@19` is gated on its live evals (fall back: map saas to `@15`, one line). |
| R7 | Request-industry bots never get order tools, even with `orderTaking` on, and the web hides orders and PMS for the `service` group. | Low. A spa that sells retail products can't take bot orders for them. To re-enable, add the industry to the shop group. |
| R8 | Server-computed `dateLabel` and `past_date` for `preferredDate`. A vague time stays free text in `preferredTime`. | Low. |
| R9 | Assistant: a new `service` industry group, two industry skills, SQL `customer_requests` view and `status_key`, and a `new_requests` report/alert template. No per-industry revenue logic. | Low. |
| R10 | `GET /crm/requests/summary` needs `contacts.view_all`, as the SaaS strip does. Staff with own-customer visibility use status filters and the per-customer card. | Low. Widening it later needs a visibility-aware query. |
| R11 | Existing education and spa businesses are not backfilled. The new statuses appear on the next read, next to the old generic ones. | Low. There is a cosmetic mix of statuses for any pre-#110 business. |
| R12 | Profile: new `branches` and `reschedule` fields; `promotion`, `payment` and `refundPolicy` widened. Multiple branches are free text, not a model. | Low. The bot cannot filter by branch; staff read the branch from the request. |

## 13. Adjustments made while building

The lanes' reports are in `.superpowers/sdd/2026-11-04-verticals-education-spa/`. What changed from the sections above:

**Contracts and data (§4, §7)**
- `phone` is a profile field for the schema, but the note has no phone line (the saas note never had one). `email` keeps its note line and stays out of the history `details`.
- The spa tool description says "never promise a slot, a therapist or a result" (no "teacher").
- `assistant_sql.product_variants` keeps the rows of offering products, with their prices, and reports null `stock_on_hand` / `stock_reserved`. Excluding them would have stopped the assistant from answering "giá khoá X" (§5.2 said "exclude").
- Migration 0064 also lets `assistant_schedules` save the `new_requests` template.
- The deprecated aliases `SaasRequestKind` and `SaasLeadDetails` (§4.1) were removed with the old saas writer: nothing used them any more.
- `CONTACT_HISTORY_TYPES` includes the two request history types, so the history tab accepts them.

**crm writer (§5.1)**
- The example `Thứ Bảy 08/11/2026` has the wrong weekday: 2026-11-08 is a Sunday. The day label is `Thứ Bảy 07/11/2026` / `Chủ Nhật 08/11/2026`. One shared helper (`vietnameseDateLabel` / `vietnameseWeekday` in `packages/shared`) now spells it for crm, the eval writer and lodging. Sunday is "Chủ Nhật", capitalised like lodging's existing labels and the "Thứ Bảy" style, not the dictionary "Chủ nhật".
- An exact retry within 24 h answers `updated` and writes nothing: no entry, no note, no status move. A call that adds details writes `contact.request_updated` and a `Cập nhật: …` note.
- The note line of `preferredDate` shows the day label. The history `details.preferredDate` stays `YYYY-MM-DD` for the SQL view.
- Summary: `statuses` lists every active status with its live customers; `open` is the newest request entry per customer in 30 days while the customer is still at the kind's target status (at most 10). `recorded7d` and `requestsRecorded` count `contact.request_recorded` only. `requestsRecorded` gives zeros, not 404, outside the request industries.
- `CrmFacade.moveContactStatus` still declares `{ forwardOnly }`. The implementation also accepts `keep`.

**commerce (§5.2)**
- Converting a product between retail and offering is allowed. `POST /products/{id}/stock` refuses an offering product (400). Staff orders are unchanged; only the bot path refuses offerings. `maxPriceVnd` still applies, and a price of 0 always passes it.

**ai (§5.3, §8)**
- The tool schema uses plain optional strings, with each field's `max` and description and the same key order as `requestDetailsSchema`. Name and phone are no longer required by the model's schema; the crm writer answers `missing:<field>`.
- `prepare_order` answers a `not_sold` item with a hint to record a request instead.
- The eval case format gained `requests_before` (requests recorded 1 h before the turn), because a live model calls `record_request` once per turn. The eval writer records in preview mode too, and its date cases use 2027 dates (move them before 2028). `eval --prompt-version n` forces a prompt version.

**seed data (§5.4)**
- In every rule that records a request, "rồi ghi nhận yêu cầu để nhân viên xác nhận." is the last sentence. The price rules ask for a phone so staff can advise, and record nothing.
- The pack greetings have no business name, because packs cannot hold placeholders. The education greeting does not say "miễn phí".

**web (§6)**
- Kind labels depend on the industry: education's `trial` is "Đăng ký học thử" and its `consultation` "Tư vấn lộ trình".
- The sidebar keeps its own education/spa label map, because shared code may not import features. The products page title follows it: "Khoá học" or "Dịch vụ".
- The order section is hidden for saas bots too (`isRequestIndustry`, ESV-R7).
- The "open" count is the summary's `open.length`, so it caps at 10.

**assistant (§5.5)**
- The import executor does not know the industry, so an imported course or service becomes a plain product. The import skill tells the owner to add the offering afterwards.
- The schedule editor offers `new_requests` only to request industries. The backend accepts it everywhere (a shop reports 0).
- `byStatus` is shown under `label` in the report result, and request kinds come from i18n.

**cleanup (Task 8)**
- `SaasFacade`, `SAAS_FACADE`, `SaasFacadeImpl`, `SaasLeadService.recordFromBot`, `leadNote` and `REQUESTED_STATUS` are deleted. `saas` keeps `assertSaas` and has no facade, like `developer`. Its contract test now checks the runner.
- The copies of the spec and the plan under new names were not made: this spec and `docs/superpowers/plans/2026-11-04-verticals-education-spa.md` stay the only copies.

**Live evals (§11.3)**
- Live, `sales-agent@19`, Hermes bridge: the requests group passed 11/15, critical 6/6. The `saas-demo-recorded-no-handoff` case fails on `@15` (the bot records, then hands off) and passes on `@19`, so saas stays on `@19` (ESV-R6). On `@19`, safety passed 5/5, handoff 1/1 and profile-facts 12/12. Of the four failures, two are negations the substring check reads as claims: "không phải cam kết chắc chắn đạt" and "chưa có thông tin về khả năng chữa khỏi dứt điểm". Two are real wording or behaviour gaps. In `spa-appointment-missing-date`, the bot says "em đã ghi nhận tên Vy và số điện thoại" before it has recorded anything. In `education-placement-test-asks-missing`, it asks for the age but not the phone.
