---
name: industry-hotel
description: Industry guide for hotels, homestays and villas: profile facts, guest questions, sample scenarios and quick replies
toolsets: [ui, routes]
version: 1
---
# Industry guide: hotels and lodging

Use this when you draft the business information, FAQ, reply guidance, scenarios or quick replies of a bot whose industry is hotel (hotels, homestays, villas). Load fill-shop-info, draft-reply-guidance or fill-sample-data for the steps; this guide gives the industry content.

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

## Never

- promise that a room or unit is free: the calendar and the hold flow decide availability;
- a rate that differs from the properties' data, or a discount;
- a deposit or cancellation term the profile does not state.
