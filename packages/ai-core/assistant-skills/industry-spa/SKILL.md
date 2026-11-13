---
name: industry-spa
description: Industry guide for spas, salons and beauty clinics: services, appointments, profile facts, scenarios, quick replies
title: Ngành spa và làm đẹp
description_vi: Hướng dẫn cho spa, salon, thẩm mỹ: dịch vụ, đặt lịch hẹn và nội dung cho bot
toolsets: [ui, routes]
version: 1
---
# Industry guide: spas, salons and beauty clinics

Use this when the owner of a spa business asks about its services or the appointments the bot recorded, and when you draft the business information, FAQ, reply guidance, scenarios or quick replies of a bot whose industry is spa (spa, salon, nail, beauty clinic). Load fill-shop-info, draft-reply-guidance or fill-sample-data for the steps; this guide gives the industry content.

## Profile facts

Besides the basic fields (`displayName`, `address`, `hotline`, `hours`), a spa business has:
- `payment`: how customers pay (cash, transfer, card, prepaid packages);
- `promotion`: current offers (first visit, packages, birthday month);
- `servicePrices`: the price of each service, or a line saying the prices are per service in the catalog;
- `booking`: how to book an appointment and how staff confirm it;
- `reschedule`: the business's own rules for changing or cancelling an appointment, and late arrival (notice, fees); never privacy, personal-data or dispute terms, which are not about appointments — leave it empty when the source has no such rules;
- `branches`: one branch per line with its address and hours.
Each one comes from the owner, pasted text or Rapiz data; never from this guide.

## Sources in Rapiz

Services are products with an `offering` of kind service (GET /products): the variants carry the prices, and the offering gives `durationMinutes` (one appointment), `sessions` (a treatment package, liệu trình), `audience`, `outcomes`, `schedule` and `priceNote`. A price of 0 means "see `priceNote`" (liên hệ, từ …). Service names, prices and durations in the profile, FAQ and scenarios must agree with the catalog; when the catalog is empty, ask the owner to add the services on /app/products and do not write prices.

The bot records appointment and consultation requests on the customer: read GET /crm/requests/summary for the counts per customer status and the latest open requests, and open /app/contacts for the list. There is no booking calendar: staff confirm every appointment, so a request is never a booked slot.

## What customers ask

Dịch vụ … giá bao nhiêu, làm mất bao lâu, liệu trình mấy buổi, còn lịch chiều nay không, đặt lịch thế nào, có cơ sở gần … không, đổi hoặc huỷ lịch được không, đến trễ thì sao, da em bị … làm được không, có đau không, đang mang bầu làm được không, có ưu đãi khách mới không. Most of these are profile fields or service data; the FAQ is for the rest, and only with sourced answers.

## Starter rules

The spa industry has its own starter rules (how to quote services, appointment requests, asking for a free slot, skin and health questions, changing or cancelling, bargaining, after an appointment request). Propose them first; draft only scenarios they do not cover.

Samples cover several services and the general topics (booking, rescheduling, branches, payment), at most 2 items about one service; a service's own data is said only of that service.

## Sample scenarios

- Khách muốn đặt lịch — Khi khách muốn đặt lịch — Hỏi dịch vụ, cơ sở, ngày và khung giờ mong muốn, tên và số điện thoại, rồi ghi nhận yêu cầu để nhân viên xác nhận.
- Khách hỏi còn lịch không — Khi khách hỏi còn lịch giờ nào đó không — Không khẳng định còn chỗ; ghi nhận ngày giờ khách muốn và nói nhân viên sẽ gọi xác nhận.
- Khách hỏi về sức khoẻ — Khi khách hỏi về tình trạng da, dị ứng, đang mang thai hoặc bệnh — Không tư vấn y khoa; xin số điện thoại và chuyển chuyên viên.
- Khách đổi lịch — Khi khách muốn đổi hoặc huỷ lịch — Trả lời theo chính sách đổi lịch trong thông tin; ghi nhận ngày giờ mới để nhân viên xác nhận.

## Sample quick replies

- banggia: bảng giá dịch vụ, from `servicePrices`.
- datlich: cách đặt lịch, from `booking`.
- doilich: đổi hoặc huỷ lịch, from `reschedule`.
- coso: danh sách cơ sở, from `branches`.
- uudai: ưu đãi hiện có, from `promotion`.
A shortcut whose source field is empty is left out; a shortcut's text is about its own topic only (the `doilich` text is never a privacy or data policy).

## Never

- a promise that a slot, a therapist or a time is free: staff confirm every appointment;
- medical advice, or a claim that a service treats or cures a condition ("chữa khỏi", "dứt điểm");
- a guaranteed result beyond the service's `outcomes`;
- a price, discount or package that is not in the catalog or the profile.
