---
name: fill-sample-data
description: Fill an empty bot page with a small editable sample (FAQ, scenarios, quick replies, profile) from real sources
toolsets: [ui, routes]
version: 2
---
# Fill sample data

Use this when the owner pressed "Nhờ trợ lý điền mẫu" on a page (the button sends a fixed request that starts with "Điền mẫu", such as "Điền mẫu câu hỏi thường gặp cho bot này: …"), or asks you to "điền mẫu" or to fill a page with sample content.

The result of this skill is always an action, never only text: one or more proposals (tool_call on the write route, with a summary), or a ui_fill_form on the page's form. Samples written only in the chat are a failure: the owner pressed a button to get drafts they can approve. Do the reads, then the writes, in this same turn; do not ask for permission first.

1. Find the page from <page_context>: the route and the title tell you which page the owner is on, and the entity gives the bot id and its industry. Do not ask the owner which page it is.
2. Sources first. Use tool_search to find the read tools and read the bot (profile facts, notes, personality), its FAQ, its training items, and the products, the SaaS plans (GET /saas-plans) or the lodging properties that apply. Load fill-shop-info or draft-reply-guidance for the page, and the industry skill (industry-retail, industry-hotel or industry-saas) when the industry has one.
3. Sample means sample wording, never sample facts. The industry examples give the wording (questions, scenario titles, triggers and instructions, quick reply texts, greeting). Every fact (address, hotline, hours, prices, fees, policies, numbers) comes only from the owner, text the owner pasted, or Rapiz data. Leave out anything that would need a missing fact.
   - Spread the samples: across the products, villas or plans (at most 2 items about any one of them) and shop-wide topics (ordering, payment, shipping or check-in, returns or cancellation, contact). A sample set about one product is a failure.
   - No detail beyond the source. Say only what the source says of that exact item: never add an extra (an amenity, a bed, a size, a gift, "và đệm phụ"), a number or a promise, even one that other items or the industry usually have. Before writing each answer, check every detail in it against the item's own data; when the source does not say it, drop it.
   - A fact belongs to the entity it came from. A product's or villa's own data (beds, amenities, price, location) is said only of that product or villa; a business-level fact (the profile address, hotline, hours) is said of the business, never attached to one villa or product unless that item's own data says so. Name the entity whose fact you use.
   - Before adding a scenario, read every existing scenario: GET /bots/{botId}/training-items with query kind=scenario, limit=5, then offset=5, 10, … until a page has fewer than 5 items (one big read is cut off and hides scenarios). Check them for one it contradicts (an older "chưa có chính sách" or a different rule on the same topic). Propose an edit of that scenario (PATCH /bots/{botId}/training-items/{itemId}) instead of a second one, or with the new one when both should stay, and say so to the owner.
4. What to draft, by page. Keep it small; the owner edits it.
   - /app/bots/{botId}/knowledge with required profile fields empty: fill the `bot-profile` form with the facts you found; then list the missing ones.
   - /app/bots/{botId}/knowledge with an empty FAQ: 5 to 8 questions customers of this industry ask, only those whose answer you have from a source and that no profile field covers, as one FAQ import proposal. If only one question has a sourced answer, fill the `faq` form instead.
   - /app/bots/{botId}/instructions with no scenarios: the starter rules proposal first, then 3 to 5 scenarios beyond the starter rules, as proposals (at most 5 per turn). For a single scenario, fill the `scenario` form instead. An empty personality: fill the `bot-personality` form from the industry's mission and greeting.
   - /app/bots/{botId}/quick-replies with no quick replies: 3 to 5 quick replies as proposals; for a single one, fill the `quick-reply` form instead.
   - Another page: say what you can fill there, or offer to open /app/bots and choose the bot.
   - When no sourced fact exists for any item, still draft the items whose wording needs no fact (a greeting, "Khách hỏi còn hàng không" answered from the product data, a hand-over to staff), and list what is missing. Draft nothing only when the bot or page cannot be found.
5. After the proposals or the fill, tell the owner, in two short lines: which parts are sample wording they should adapt to their shop, and which facts are still missing (one list). Ask for the missing facts.
6. Never put template placeholders in double braces, links, images or customer data in a sample.
7. A fill never saves, and a proposal waits for the owner's approval. Never say anything is saved until the event message says so.
