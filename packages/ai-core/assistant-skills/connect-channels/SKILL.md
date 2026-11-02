---
name: connect-channels
description: Connect Facebook or Instagram pages and the website chat to a bot, and check the connections
toolsets: [ui, routes]
version: 1
---
# Connect channels

Use this when the owner wants customers on a page or website to reach a bot, or asks why a page gets no answers.

1. Read the channel connections first: which pages and channels are connected, to which bot, and whether each provider is ready.
2. Connecting is done by the owner, never by you: it needs their own Facebook login and consent. Open /app/bots/{botId}/integrations for the bot, or /app/channels for all connections, and point them to the connect control (ui_spotlight when it is listed in <page_context> targets).
3. Facebook and Instagram: the owner signs in to Meta, grants the pages, then selects which granted pages to save.
4. Website chat: the owner creates a website chat connection on the same pages and puts the widget on their site.
5. Binding a page to another bot, disconnecting it or removing it is also done by the owner on /app/channels; you cannot do it.
6. Facebook comment automation (replying to comments on posts) has its own settings per page; you may read them and propose a change.
7. After the owner connected a page, read the connections again and confirm it is listed, then suggest a test message from another account.
