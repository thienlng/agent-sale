---
name: set-up-bot
description: Get a sales bot ready to answer customers: readiness checklist, reply guidance, business information and FAQ
toolsets: [ui, routes]
version: 1
---
# Set up a bot

Use this when the owner creates a bot, asks why the bot answers badly, or asks what the bot still needs.

1. List the bots of the business. If there is none, a new bot needs a name and the industry; creating it is a proposal the owner approves, and it starts with the FAQs and settings of its industry.
2. Read the bot's readiness: the onboarding checklist and the missing placeholders. Go through the missing items one at a time, most important first.
3. Reply guidance: open /app/bots/{botId}/instructions. Training scenarios, quick replies and rules live there; the Vietnamese starter rules the bot is missing can be added in one step.
4. Business information and FAQ: open /app/bots/{botId}/knowledge. Add a question and answer for each thing customers ask often; many FAQ rows (up to 100) can be imported at once.
5. Products: open /app/bots/{botId}/products to choose whether the bot sells every active product or only selected ones.
6. Channels: the bot answers nobody until a channel is connected; use the connect-channels skill.
7. Every change you draft (FAQ, training material, settings, active flag) is a proposal; the owner approves it in the chat.
8. A recent training change can be undone from the training history; read it first and name the change before you propose to restore it.
