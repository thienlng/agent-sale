---
name: industry-education
description: Industry guide for language and training centres: courses, requests, profile facts, scenarios and quick replies
title: Ngành giáo dục
description_vi: Hướng dẫn cho trung tâm ngoại ngữ, đào tạo: khoá học, đăng ký học thử và nội dung cho bot
toolsets: [ui, routes]
version: 1
---
# Industry guide: education (language and training centres)

Use this when the owner of an education business asks about its courses or the requests the bot recorded, and when you draft the business information, FAQ, reply guidance, scenarios or quick replies of a bot whose industry is education. Load fill-shop-info, draft-reply-guidance or fill-sample-data for the steps; this guide gives the industry content.

## Profile facts

Besides the basic fields (`displayName`, `address`, `hotline`, `hours`), an education business has:
- `payment`: how students pay the tuition (transfer, card, instalments);
- `promotion`: current offers (early-bird fees, sibling or group discounts);
- `courseFees`: the tuition of each course, or a line saying the fees are per course in the catalog;
- `courseSchedule`: opening dates (lịch khai giảng), class days and times;
- `courseTrial`: the trial class or the placement test, whether it is free, how to register;
- `refundPolicy`: tuition refunds, deferrals (bảo lưu) and transfers;
- `branches`: one branch per line with its address and hours, and "Học online" when there are online classes.
Each one comes from the owner, pasted text or Rapiz data; never from this guide.

## Sources in Rapiz

Courses are products with an `offering` of kind course (GET /products): the variants carry the prices, and the offering gives `durationMinutes` (one session), `sessions`, `period`, `format` (online, offline, hybrid), `level`, `schedule`, `audience`, `outcomes` and `priceNote`. A price of 0 means "see `priceNote`" (liên hệ, từ …). Course names, fees, levels and outcomes in the profile, FAQ and scenarios must agree with the catalog; when the catalog is empty, ask the owner to add the courses on /app/products and do not write fees.

The bot records placement-test, trial-class and consultation requests on the customer: read GET /crm/requests/summary for the counts per customer status and the latest open requests, and open /app/contacts for the list. A request is a wish the staff confirm, never a booked seat.

## What students and parents ask

Học phí khoá … bao nhiêu, học bao lâu, mấy buổi một tuần, lớp mấy người, khi nào khai giảng, có học thử không, kiểm tra trình độ thế nào, con em … tuổi học lớp nào, học online được không, cơ sở ở đâu, có cam kết đầu ra không, nghỉ thì có học bù không, có bảo lưu hay hoàn học phí không, có trả góp không. Most of these are profile fields or course data; the FAQ is for the rest, and only with sourced answers.

## Starter rules

The education industry has its own starter rules (how to quote fees, trial class and placement test requests, a parent asking for a child, outcome questions, opening dates and branches, bargaining, after a request). Propose them first; draft only scenarios they do not cover.

Samples cover several courses and the general topics (trial, placement test, schedule, branches, payment), at most 2 items about one course; a course's own data is said only of that course.

## Sample scenarios

- Phụ huynh hỏi cho con — Khi phụ huynh hỏi khoá học cho con — Hỏi tuổi hoặc trình độ của bé và mục tiêu, gợi ý khoá phù hợp theo danh mục, rồi mời đăng ký kiểm tra trình độ; xưng hô với phụ huynh, không với bé.
- Khách muốn học thử — Khi khách muốn học thử hoặc kiểm tra trình độ — Hỏi khoá quan tâm, trình độ, cơ sở hoặc online, thời gian mong muốn, tên và số điện thoại, rồi ghi nhận yêu cầu để nhân viên xác nhận.
- Khách hỏi lịch khai giảng — Khi khách hỏi khi nào có lớp — Trả lời theo lịch trong thông tin; không khẳng định lớp còn chỗ; mời khách đăng ký để nhân viên xác nhận.
- Khách hỏi cam kết đầu ra — Khi khách hỏi học xong có chắc đạt không — Chỉ nói đúng đầu ra của khoá trong danh mục; không cam kết kết quả; mời kiểm tra trình độ để được tư vấn lộ trình.

## Sample quick replies

- hocphi: học phí các khoá, from `courseFees`.
- lichhoc: lịch khai giảng và lịch học, from `courseSchedule`.
- hocthu: cách đăng ký học thử hoặc kiểm tra trình độ, from `courseTrial`.
- coso: danh sách cơ sở, from `branches`.
- uudai: ưu đãi hiện có, from `promotion`.
A shortcut whose source field is empty is left out.

## Never

- a promise that a class has a seat, a teacher or a start date the data does not state;
- a guaranteed result (an exam score, a certificate, "chắc chắn đạt") beyond the course's `outcomes`;
- a fee, discount or instalment plan that is not in the catalog or the profile;
- a refund or deferral term the profile does not state.
