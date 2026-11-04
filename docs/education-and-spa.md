# Education and spa businesses (ADR-025)

A business with industry `education` (language or training centre) or `spa` (spa, salon, beauty clinic) sells courses or services. The bot does not sell them through orders. It records a **request** on the CRM customer, and staff confirm it by phone or chat. There is no slot engine: the bot never knows whether a class or an appointment slot is free.

Both industries can be picked at sign-up and when a business is created (`SELECTABLE_INDUSTRIES`). The same request flow serves `saas` ([SaaS businesses](saas.md)).

## Customer statuses

Each industry gets its own built-in statuses, seeded on the first status read. They are editable and orderable in CRM settings. A business created before these sets existed gets them next to its generic statuses (no backfill).

| education key | Name | spa key | Name |
| --- | --- | --- | --- |
| `new_lead` | Lead mới | `new_lead` | Khách mới |
| `consulting` | Đang tư vấn | `consulting` | Đang tư vấn |
| `test_requested` | Đăng ký test / học thử | `booking_requested` | Yêu cầu đặt lịch |
| `test_scheduled` | Đã hẹn test / học thử | `booked` | Đã xác nhận lịch |
| `tested` | Đã test / học thử | `visited` | Đã đến |
| `enrolled` | Đã đăng ký học | `no_show` | Không đến |
| `lost` | Không theo học | `lost` | Không quan tâm |

Staff set every status by hand except the ones a request moves to:

| Industry | Request kind | Moves the customer to | Unless the customer is at |
| --- | --- | --- | --- |
| education | `placement_test` (Đăng ký kiểm tra trình độ), `trial` (Đăng ký học thử) | `test_requested` | `test_scheduled`, `tested`, `enrolled` |
| education | `consultation` (Tư vấn lộ trình) | `consulting` | `test_requested`, `test_scheduled`, `tested`, `enrolled` |
| spa | `appointment` (Đặt lịch) | `booking_requested` | `booked` |
| spa | `consultation` (Xin tư vấn) | `consulting` | `booking_requested`, `booked`, `visited` |

The rule is "move unless at a confirmed status", not "forward only". A returning customer who asks again goes back into the queue: a `visited` spa customer who books again moves to `booking_requested`, and an `enrolled` student who asks for a new consultation stays `enrolled`. Each move leaves the usual `contact.status_changed` history entry and event.

## What the bot collects

The bot calls its built-in tool `record_request` once it knows the name and a phone number the customer wrote themselves (the last 9 digits must appear in the customer's messages). For a spa appointment it also needs the service and a day or a time. Before calling, it asks for the details worth having, at most two per message:

- **education:** the course or the goal, the student's age or level, the branch or "online", and a preferred time or day. A parent can register a child: the student's name and age go in their own fields.
- The course or service field holds the catalog name. When the bot leaves it empty but names a course it saw in the conversation in `goal` (education) or a service in `note` (spa), crm fills the field with that catalog name (every distinctive word of the name in the text, one name only).
- **spa:** the service, the branch, the day and the time window, and how many people come.

A day the customer named is stored as `YYYY-MM-DD`. The server writes its label ("Thứ Bảy 07/11/2026") and the bot repeats it, so the bot never works out a weekday itself. A day before today (Vietnam time) is refused, and the bot asks for a future day. Vague times ("tối thứ 3-5", "sau 18h") stay as the customer wrote them.

Each request:

1. finds the customer by phone, or creates it (a website visitor named "Khách website ####" takes the name they gave);
2. moves the status as in the table above;
3. adds a note signed **Bot AI**: the kind ("Đặt lịch (bot ghi nhận)") and one line per detail given;
4. adds the history entry `contact.request_recorded`.

The same kind again within 24 hours is an **update**: the entry is `contact.request_updated` and the note starts with "Cập nhật:". An exact retry (the same details as the latest request of that kind) writes nothing, even when staff added a note in between. A customer first captured from the website (a phone typed in the chat) starts at the first status ("Lead mới" / "Khách mới"). Playground conversations validate and write nothing.

## Where staff see requests

- **Customer list** (`/app/contacts`), for members with `contacts.view_all`: a strip on top with the customers per status (a click filters the list) and the latest open requests (the last 30 days, still at the kind's target status, at most 10; a click opens the customer).
- **Customer sheet and the Inbox sales panel**: a "Yêu cầu" card with the customer's latest requests: kind, course or service, branch, day or time, and when it was recorded. In the Inbox it replaces the orders block.
- **The customer's notes and history**: the Bot AI note and the history entry.
- **Owner assistant**: questions such as "tuần này có bao nhiêu khách đặt lịch" (SQL view `customer_requests`), and a `new_requests` report or alert. Both take `kinds`, so "báo khi có khách đặt lịch mới" counts appointments only (`kinds: ["appointment"]`); without it every kind counts.

API: `GET /crm/requests/summary` (`contacts.view_all`; 404 outside saas, education and spa) and `GET /contacts/{contactId}/requests` (the latest 10, same visibility as the customer). Both accept workspace API keys.

## Courses and services

A course or a service is a product with an **offering** (product form, "Chi tiết khoá học" or "Chi tiết dịch vụ"): duration per session or appointment, number of sessions, period, format (online, offline, hybrid), level, schedule, audience, up to 5 outcomes and a price note. In these businesses the products page is called "Khoá học" or "Dịch vụ". An offering has no stock, and the bot never says it is in or out of stock. A price of 0 means "not published": the bot says the price note ("liên hệ") and never "0đ". A spa can still sell retail products (the "Đây là sản phẩm bán lẻ" switch), but its bot takes no orders. Imported products become plain products, so add the offering afterwards.

## What the bot never promises

- It never says "đã đặt lịch", "đã xác nhận", "đã giữ chỗ" or "đã đăng ký thành công". It says the request "đã được ghi nhận" and that staff will contact the customer to confirm.
- It never promises a slot, a teacher, a therapist or a result. Course outcomes are quoted only as written in the offering, never as a guarantee.
- It gives no medical advice and makes no treatment claims ("chữa khỏi", "dứt điểm").
- Recording a request is never a reason to hand off. The bot keeps answering afterwards.

## Limits

- No availability, resources, reminders, class rosters, attendance or tuition invoices.
- No requests page and no per-request status or assignment: the customer status is the queue.
- The tool does not link the conversation to the customer. Facebook, Instagram and webchat link by phone or lead; staff link a Zalo conversation.
