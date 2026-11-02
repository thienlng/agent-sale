---
name: fill-sample-data
description: Fill an empty bot page with a small editable sample (FAQ, scenarios, quick replies, profile) from real sources
toolsets: [ui, routes]
version: 1
---
# Fill sample data

Use this when the owner pressed "Nhờ trợ lý điền mẫu" on a page (the button sends a fixed request such as "Soạn giúp mình vài câu hỏi thường gặp mẫu cho shop." or "Điền giúp mình các thông tin doanh nghiệp còn thiếu."), or asks you to "điền mẫu" or to fill a page with sample content.

1. Find the page from <page_context>: the route and the title tell you which page the owner is on, and the entity gives the bot id and its industry. Do not ask the owner which page it is.
2. Sources first. Use tool_search to find the read tools and read the bot (profile facts, notes, personality), its FAQ, its training items, and the products, the SaaS plans (GET /saas-plans) or the lodging properties that apply. Load fill-shop-info or draft-reply-guidance for the page, and the industry skill (industry-retail, industry-hotel or industry-saas) when the industry has one.
3. Sample means sample wording, never sample facts. The industry examples give the wording (questions, scenario titles, triggers and instructions, quick reply texts, greeting). Every fact (address, hotline, hours, prices, fees, policies, numbers) comes only from the owner, text the owner pasted, or Rapiz data. Leave out anything that would need a missing fact.
4. What to draft, by page. Keep it small; the owner edits it.
   - /app/bots/{botId}/knowledge with required profile fields empty: fill the `bot-profile` form with the facts you found; then list the missing ones.
   - /app/bots/{botId}/knowledge with an empty FAQ: 5 to 8 questions customers of this industry ask, only those whose answer you have from a source and that no profile field covers, as one FAQ import proposal. If only one question has a sourced answer, fill the `faq` form instead.
   - /app/bots/{botId}/instructions with no scenarios: the starter rules proposal first, then 3 to 5 scenarios beyond the starter rules, as proposals (at most 5 per turn). For a single scenario, fill the `scenario` form instead. An empty personality: fill the `bot-personality` form from the industry's mission and greeting.
   - /app/bots/{botId}/quick-replies with no quick replies: 3 to 5 quick replies as proposals; for a single one, fill the `quick-reply` form instead.
   - Another page: say what you can fill there, or offer to open /app/bots and choose the bot.
5. Tell the owner, in two short lines: which parts are sample wording they should adapt to their shop, and which facts are still missing (one list). Ask for the missing facts.
6. Never put template placeholders in double braces, links, images or customer data in a sample.
7. A fill never saves, and a proposal waits for the owner's approval. Never say anything is saved until the event message says so.
