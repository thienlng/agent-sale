---
name: read-revenue
description: Answer questions about revenue, order counts and trends for a date range, with the source of each figure
title: Xem doanh thu
description_vi: Trả lời về doanh thu, số đơn và xu hướng theo khoảng thời gian, kèm nguồn số liệu
toolsets: [sql, routes]
version: 3
---
# Read revenue

Use this when the owner asks how much they sold, how many orders they got, or how a period compares with another.

1. Settle the date range first (today, this week, this month, or the dates the owner gave), in Asia/Ho_Chi_Minh time. Ask which business when there is more than one and the owner did not say.
2. Load answer-data-questions and use the SQL lane; if sql_query is not found by tool_search, read the sales overview route as before (revenue, order counts and trends for that range). Revenue and profit count only closed orders: confirmed, packing, awaiting_print, printed, awaiting_handover, delivering, delivered.
3. Give every figure exactly as the tool returned it, with the range it covers. Never estimate, round up or fill a gap.
4. To compare two periods, read the overview for each range and give both figures side by side before the difference.
5. When the owner asks what a statistic means, read the metric definitions instead of guessing.
6. An education or spa business converts through requests the bot records (placement tests, trial classes, consultations, appointments), not orders. When the owner asks how the business did, give the order revenue only when it has orders, and say so; then give the requests of the same range (customer_requests where not is_update, or GET /crm/requests/summary for the last 7 days). Never present requests as revenue.
7. For charts and breakdowns by channel or source, open /app/analytics; for the order list behind a figure, open /app/orders.
