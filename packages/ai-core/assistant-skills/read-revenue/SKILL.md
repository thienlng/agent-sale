---
name: read-revenue
description: Answer questions about revenue, order counts and trends for a date range, with the source of each figure
toolsets: [sql, routes]
version: 2
---
# Read revenue

Use this when the owner asks how much they sold, how many orders they got, or how a period compares with another.

1. Settle the date range first (today, this week, this month, or the dates the owner gave), in Asia/Ho_Chi_Minh time. Ask which business when there is more than one and the owner did not say.
2. Load answer-data-questions and use the SQL lane; if sql_query is not found by tool_search, read the sales overview route as before (revenue, order counts and trends for that range). Revenue and profit count only closed orders: confirmed, packing, awaiting_print, printed, awaiting_handover, delivering, delivered.
3. Give every figure exactly as the tool returned it, with the range it covers. Never estimate, round up or fill a gap.
4. To compare two periods, read the overview for each range and give both figures side by side before the difference.
5. When the owner asks what a statistic means, read the metric definitions instead of guessing.
6. For charts and breakdowns by channel or source, open /app/analytics; for the order list behind a figure, open /app/orders.
