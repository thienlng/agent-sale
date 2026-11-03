---
name: set-up-schedules
description: Turn "send me … every …" or "tell me when …" into a report or alert schedule the owner approves
title: Lịch báo cáo và cảnh báo
description_vi: Tạo lịch gửi báo cáo định kỳ hoặc cảnh báo khi có việc cần chú ý
toolsets: [schedule]
version: 1
---
# Set up schedules

Use this when the owner wants a figure sent on a rhythm ("mỗi sáng 8h gửi doanh thu hôm qua") or wants to be told when something happens ("báo em khi có khách chờ quá 30 phút"). Rapiz computes the report in code and delivers it; you only draft the schedule.

1. Call schedule with action list first, so you do not create a duplicate and you know how many of the 10 places are used.
2. Pick the template:
   - revenue, sales, profit → revenue_summary (report only); for a hotel it reports the stays (stay revenue, nights sold, bookings, profit) checking in during the period, so "doanh thu lưu trú" is revenue_summary too;
   - new orders → new_orders (report: orders placed in the period; alert: minCount new orders since the last check);
   - products running out → low_stock (threshold, default 5);
   - customers waiting for a reply → unanswered_conversations (minutes, default 30; minCount, default 1);
   - new customers → new_customers (report only).
3. Pick the mode: "gửi / báo cáo mỗi …" is a report; "báo khi …" is an alert. Alerts are checked on an every cadence only, minutes in 15, 30, 60, 120, 180, 240, 360 or 720 (default 30).
4. Turn the phrase into a cadence, Asia/Ho_Chi_Minh time:
   - "mỗi sáng 8h", "hằng ngày lúc 8 giờ" → daily {at:'08:00'};
   - "thứ Hai hằng tuần" → weekly {days:[1], at}; Monday = 1 … Sunday = 7;
   - "ngày 1 hằng tháng" → monthly {day:1, at}; "cuối tháng" → monthly {day:-1, at};
   - "mỗi 2 tiếng" → every {minutes:120}; reports need at least 60 minutes; "trong giờ làm việc" → activeFrom/activeTo.
   When no time is given, use 08:00.
5. Pick the period of a report: "hôm qua" → day + previous; "hôm nay đến giờ" → day + to_date; "tuần trước" → week + previous; "tháng này" → month + to_date. Weeks run Monday to Sunday.
6. Channels: always in_app. Add email only when the owner mentions email; it goes to the owner's login address. Leave commentary off unless the owner asks for your comment on the figures.
7. Name the schedule in a few Vietnamese words ("Doanh thu tuần trước"). Call schedule with action create, the draft and a Vietnamese summary, then tell the owner to approve the card. Never say it is set up before the event message says it was applied.
8. To change or stop a schedule: edit or remove need the owner's approval; pause, resume and run act at once.
