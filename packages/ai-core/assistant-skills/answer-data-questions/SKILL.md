---
name: answer-data-questions
description: Answer number questions about the shop (revenue, orders, products, customers, requests) from the read-only SQL views
title: Hỏi số liệu cửa hàng
description_vi: Trả lời câu hỏi về doanh thu, đơn hàng, sản phẩm, khách hàng từ dữ liệu của shop
toolsets: [sql]
version: 2
---
# Answer data questions

Use this when the owner asks for a figure, a ranking or a trend: revenue this week, top products last month, new customers by source, messages per day, nights booked.

1. Find the tools with tool_search, for example "revenue sql". The entries are sql_schema and sql_query; their input goes in the body of tool_call.
2. Call tool_call with key sql_schema to read the rules and the views. Ask for one view (body {"view": "orders"}) when you need its column types and examples.
3. Settle the date range in Asia/Ho_Chi_Minh time (today, this week from Monday, this month, last month, or the dates the owner gave) and the business. By default use all of the owner's businesses; when there is more than one, group by business_id and join businesses for the names. Pass businessIds only to narrow to the business the owner named.
4. Write one aggregated SELECT with a date filter (WITH is fine) and run it with tool_call key sql_query. Do not list raw rows when a sum, a count or a top N answers the question.
5. Revenue (doanh thu) is sum(total) over orders where counts_as_revenue, which means closed orders. Say so, and give the date range the figure covers. A hotel business (industry hotel) sells stays: its revenue is sum(total_sell) over lodging_bookings where counts_as_revenue (confirmed, checked in or out), by check_in date, with nights sold and profit (total_sell - total_cost) next to it. When the owner says "doanh thu" of a hotel, use lodging_bookings, not orders. Sales (doanh số) count every order that is not cancelled; profit is sum(profit) over closed orders.
6. An education or spa business (industry education or spa) converts through requests the bot records, not orders: new requests (khách đặt lịch, đăng ký học thử, kiểm tra trình độ) are a count over customer_requests where not is_update, by created_at, grouped by kind when it helps. "Khách theo trạng thái" or "requests by status" is customers grouped by status_name. Answer its revenue from orders only when it has orders, and say so.
7. Pass chart only for a time series or a ranking of 3 or more points: a line or bar chart for days or weeks, a bar chart for a top N, a pie chart for a share of at most 12 parts. Name the result columns in x and y, give a short title and the unit (vnd, count, percent or number). The chart is built from the rows; do not repeat every point in the answer, give the total and the highlights.
8. On sql_timeout, or when rowsShown is less than rowCount, narrow the range or aggregate more and run again. On sql_rejected, read the reason and rewrite the query. Never estimate, extrapolate or fill a gap with a guess.
9. Give every figure exactly as the query returned it. A total over a breakdown (all products across categories, all orders across statuses) comes from the query too, never from adding the rows yourself: add it as a column (`sum(n) over ()`) or a total row (`ROLLUP`, or a `UNION ALL` of the total), or run a count. Money is integer VND; write it as VND (for example 1.250.000 ₫).
10. Customer phone numbers and emails are not in the views. When the owner wants contact details, open /app/contacts instead.
