---
name: industry-saas
description: Industry guide for software (SaaS) businesses: profile facts, buyer questions, sample scenarios and quick replies
toolsets: [ui, routes]
version: 1
---
# Industry guide: software (SaaS)

Use this when you draft the business information, FAQ, reply guidance, scenarios or quick replies of a bot whose industry is saas. Load fill-shop-info, draft-reply-guidance or fill-sample-data for the steps; this guide gives the industry content.

## Profile facts

Besides the basic fields (`displayName`, `address`, `hotline`, `hours`), a software business has:
- `plans`: the plans and what each includes;
- `freeTrial`: whether there is a free trial, how long, how to start it;
- `demo`: how to book a demo;
- `integrations`: the systems it connects with;
- `onboarding`: how a new customer is set up and trained;
- `support`: support channels and hours;
- `dataSecurity`: where data is stored and how it is protected;
- `refundPolicy`: refund terms;
- `payment`: how customers pay (transfer, card, invoice).
Each one comes from the owner, pasted text or Rapiz data; never from this guide.

## Sources in Rapiz

Read the SaaS plans (GET /saas-plans) first. Plan names, prices and billing periods come only from there: the `plans` field and every FAQ or scenario must agree with them. When the plans list is empty, ask the owner to add the plans; do not write prices.

## What buyers ask

Có những gói nào, giá bao nhiêu, tính theo tháng hay năm, có dùng thử không, có demo không, có tích hợp với … không, dữ liệu lưu ở đâu, có xuất hóa đơn không, hỗ trợ thế nào, có hoàn tiền không. Most of these are profile fields; the FAQ is for the rest, and only with sourced answers.

## Starter rules

The saas industry has its own starter rules (how to quote plans, demo and trial requests, missing features, bargaining, data security, after a request). Propose them first; draft only scenarios they do not cover.

Samples cover several plans and the general topics (trial, demo, integrations, data, support), at most 2 items about one plan; a plan's own data is said only of that plan.

## Sample scenarios

- So sánh gói — Khi khách hỏi nên chọn gói nào — Hỏi quy mô và nhu cầu chính, rồi so sánh các gói theo đúng thông tin gói cước; không tự đưa giá riêng.
- Đăng ký dùng thử — Khi khách muốn dùng thử — Hướng dẫn theo thông tin dùng thử đã có; xin tên, số điện thoại hoặc email và tên công ty để nhân viên mở tài khoản.
- Hỏi hợp đồng, hóa đơn — Khi khách hỏi hợp đồng, hóa đơn hoặc điều khoản pháp lý — Chuyển nhân viên, không tự cam kết.
- Khách đang dùng gặp lỗi — Khi khách báo lỗi khi đang dùng sản phẩm — Hỏi mô tả lỗi và thông tin liên hệ, chuyển bộ phận hỗ trợ theo kênh hỗ trợ trong thông tin.

## Sample quick replies

- banggia: tóm tắt các gói, from the SaaS plans.
- demo: cách đặt lịch demo, from `demo`.
- dungthu: cách bắt đầu dùng thử, from `freeTrial`.
- hotro: kênh hỗ trợ, from `support`.

## Never

- a plan, price, billing period or discount that is not in the SaaS plans;
- a feature or integration the profile does not state;
- a security certificate, data location or refund term the profile does not state.
