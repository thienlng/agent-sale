---
name: set-up-bot
description: Get a sales bot ready to answer customers: readiness checklist, reply guidance, business information and FAQ
title: Thiết lập bot bán hàng
description_vi: Chuẩn bị bot sẵn sàng trả lời khách: danh sách việc cần làm, cách trả lời, thông tin, FAQ
toolsets: [ui, routes]
version: 3
---
# Set up a bot

Use this when the owner creates a bot or asks what the bot still needs. When the owner asks why the bot answered a customer badly, use the bot-doctor skill instead; to connect the bot to the owner's own API, use set-up-api-action.

1. List the bots of the business. If there is none, a new bot needs a name and the industry; creating it is a proposal the owner approves, and it starts with the FAQs and settings of its industry.
2. Read the bot's readiness: the onboarding checklist and the missing placeholders. Go through the missing items one at a time, most important first.
3. Reply guidance: open /app/bots/{botId}/instructions. The personality (mission, greeting, pronouns, tone) and the training scenarios live there; the Vietnamese starter rules the bot is missing can be added in one step. Quick replies have their own page: /app/bots/{botId}/quick-replies. Before drafting any of them, load draft-reply-guidance and the industry skill (industry-retail, industry-hotel, industry-saas, industry-education or industry-spa) when the bot's industry has one.
4. Business information and FAQ: open /app/bots/{botId}/knowledge. Before drafting, load fill-shop-info and the industry skill. Facts come only from the owner, pasted text or Rapiz data; many FAQ rows can be imported at once as one proposal.
5. Products: open /app/bots/{botId}/products to choose whether the bot sells every active product or only selected ones. An education or spa business sells courses or services: they are products with an offering (load add-products), and the bot records placement-test, trial-class, consultation or appointment requests on the customer instead of taking orders.
6. Channels: the bot answers nobody until a channel is connected; use the connect-channels skill.
7. A form listed in <page_context> forms is filled with ui_fill_form and the owner saves it; every other change you draft (FAQ, training material, settings, active flag) is a proposal the owner approves in the chat.
8. An empty page (FAQ, scenarios, quick replies) shows the owner a "Nhờ trợ lý điền mẫu" button; it sends you a request to fill a sample: load fill-sample-data.
9. A recent training change can be undone from the training history; read it first and name the change before you propose to restore it.
