---
name: industry-hotel
description: Hotels, homestays, villas: questions about villas, rooms and bookings; profile facts, FAQ, scenarios, quick replies
title: Ngành lưu trú
description_vi: Hướng dẫn cho khách sạn, homestay, villa: phòng, giá, đặt phòng và nội dung cho bot
toolsets: [ui, routes]
version: 1
---
# Industry guide: hotels and lodging

Use this when the owner of a hotel business asks about its villas, rooms, prices or bookings, and when you draft the business information, FAQ, reply guidance, scenarios or quick replies of a bot whose industry is hotel (hotels, homestays, villas). Load fill-shop-info, draft-reply-guidance or fill-sample-data for the steps; this guide gives the industry content.

## Profile facts

Besides the basic fields (`displayName`, `address`, `hotline`, `hours`), a lodging business has:
- `unitTypes`: room or unit types, capacity, beds;
- `rates`: prices per night, weekend or holiday rates;
- `checkInOut`: check-in and check-out times, early check-in or late check-out;
- `deposit`: how much deposit and how to pay it;
- `cancellation`: cancellation and change terms;
- `amenities`: pool, breakfast, parking, kitchen and the like;
- `childrenPets`: rules for children, extra guests and pets;
- `directions`: how to get there, pickup.
Each one comes from the owner, pasted text or Rapiz data; never from this guide.

## Sources in Rapiz

Read the lodging properties (units and rates) first. Unit types and rates in the profile must agree with the properties' data; when they differ, ask the owner which is right. The bot already reads availability from the calendar and makes holds; the profile never states availability.

## Questions about the business's own villas

A hotel sells nights, not stock. When the owner names a villa or room by a short code or name ("A20 thì sao?", "căn nào có bể bơi?"), read the lodging properties (`GET /lodging/properties`, then `GET /lodging/properties/{id}` for units, rates and amenities) before anything else; the product catalog is for shops. Availability is in the calendar (`GET /lodging/calendar`, `POST /lodging/availability`), prices for given dates in `POST /lodging/quote`, bookings and bot holds in `GET /lodging/bookings`. Holds are built in: the bot checks the calendar and holds a villa itself, and the owner reviews holds on /app/bookings; it needs no API action for that.

## Date-range prices (overrides)

A date-range price (`POST /lodging/properties/{id}/overrides`) targets the whole property or one room. For a property sold whole (`sellMode: whole`, one villa rented as a unit), always send `unitId: null`; never the id of its whole-villa unit. Only a property sold by room (`sellMode: rooms`) takes a room's `unitId`, and only for a price of that room. When an approved write fails, the event gives the API's reason (code, message, field issues): fix that field and propose again.

## What guests ask

Còn phòng ngày … không, giá một đêm bao nhiêu, cuối tuần có tăng giá không, phòng ở được mấy người, có bữa sáng không, có hồ bơi không, mấy giờ nhận phòng, có được nhận phòng sớm không, đặt cọc bao nhiêu, hủy phòng thế nào, có cho mang thú cưng không, đi đường nào. Most of these are profile fields; the FAQ is for the rest, and only with sourced answers.

## Starter rules

The hotel industry has its own starter rules (availability questions, booking, bargaining, directions, after a booking). Propose them first; draft only scenarios they do not cover.

## Sample scenarios

- Hỏi nhận phòng sớm — Khi khách hỏi nhận phòng sớm hoặc trả phòng muộn — Trả lời theo giờ nhận/trả phòng trong thông tin; việc nhận sớm tùy tình trạng phòng nên mời khách để lại số điện thoại để lễ tân xác nhận.
- Hỏi đặt cọc — Khi khách hỏi đặt cọc bao nhiêu và chuyển thế nào — Chỉ trả lời theo thông tin đặt cọc đã có; nếu chưa có, nói nhân viên sẽ hướng dẫn.
- Đi đông người — Khi khách đi nhóm đông hoặc có trẻ em — Hỏi số người lớn, trẻ em và ngày đi, gợi ý loại phòng phù hợp theo dữ liệu, không tự hứa kê thêm giường.
- Hỏi hủy phòng — Khi khách muốn hủy hoặc đổi ngày — Trả lời theo chính sách hủy trong thông tin và chuyển nhân viên xử lý.

## Sample quick replies

- giaphong: bảng giá phòng, from `rates` and the properties' rates.
- coc: hướng dẫn đặt cọc, from `deposit`; the bank details come from the owner.
- checkin: giờ nhận và trả phòng, from `checkInOut`.
- duongdi: hướng dẫn đường đi, from `directions`.

## Facts per villa

A villa's own data (beds, rooms, amenities, rates, location text) is said only of that villa. The profile address and directions are the business's; do not put them on one villa (for example "A20 ở khu …") unless that villa's own data gives its location. Samples cover the villas evenly and the general topics (booking, deposit, check-in, cancellation, directions).

## Never

- promise that a room or unit is free: the calendar and the hold flow decide availability;
- a rate that differs from the properties' data, or a discount;
- a deposit or cancellation term the profile does not state.
