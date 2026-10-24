# Bot training workspace

The bot workspace follows the Preny layout (T-047): a training menu (home, products, instructions, information/FAQ, integrations, image library, a Settings group with bot setup, quick replies and edit history, and a Development group with the Facebook ads tool) next to the section content, and the test chat docked on the right with up to three FAQ questions as suggestions. Below desktop widths the test chat opens in a sheet.

The home page is a four-step checklist in this order: connect a platform, products, situation instructions, FAQs. A newly created bot opens on its integrations page, because a bot without a channel cannot answer anyone.

Products reuse the workspace's operational commerce catalog, including its `visibleToBot` flag and optional `botInstructions` guidance (up to 4000 characters) and up to 5 `imageUrls` (https links, 2000 characters each; migration `0014_product_images.sql`, column `products.image_urls jsonb not null default '[]'` with a CHECK that it is an array of at most 5) that the bot may send when a customer asks to see the product (see `06-ai-engine.md`, bot-sent pictures; edited in the product form under "Ảnh sản phẩm"). They are not copied into a separate bot catalog. Integrations list the pages bound to the bot; connecting a page from there binds it to the bot (see `meta-inbox.md`). FAQ and settings retain their existing APIs.

## Training materials

The knowledge module owns `training_items` and `training_history` (migration `0008_training.sql`). The bot module exposes the HTTP routes and verifies bot ownership before calling the knowledge facade. Every route requires authentication and workspace membership. Queries use a workspace transaction and forced row level security. Material writes and history insertion commit together.

- `GET /api/v1/bots/{botId}/training-items`: up to 500 materials, newest updates first.
- `POST /api/v1/bots/{botId}/training-items`: create a material.
- `PATCH /api/v1/bots/{botId}/training-items/{itemId}`: edit a material without changing its kind.
- `DELETE /api/v1/bots/{botId}/training-items/{itemId}`: delete a material; preserve its history.
- `GET /api/v1/bots/{botId}/training-history`: latest 200 changes (materials, FAQs, settings).
- `POST /api/v1/bots/{botId}/training-history/{historyId}/restore`: put back the state before a restorable entry (204). The restore is recorded as a new entry.

A material has `kind` (`scenario`, `quick_reply`, `media`, `media_folder`), `title` (1–2000 characters), `content` (1–8000), `trigger` (0–500), nullable `mediaUrl` (HTTPS only, up to 2000 characters) and nullable `folderId` (migration `0012`). Only `media` may have a `folderId`, and it must be a `media_folder` of the same bot; deleting a folder deletes and records its media first. Boundary validation trims text and rejects empty updates.

History stores action, title, kind, record ID, timestamp, the actor's display name (snapshotted through the identity facade; empty for system changes), the changed fields (`changes: [{field, before, after}]`) and, for item updates and deletions, the item before the change (`snapshot`). An entry is `restorable` when it is a settings change with field changes, or an item creation/update/deletion; FAQ entries are not restorable. Restoring a creation deletes the item; restoring an update or deletion saves the snapshot back (outside any folder if the folder no longer exists). Bot ownership and workspace isolation also apply to history.

Instruction scenarios provide guidance for bot generation through the knowledge public API. Quick replies are saved team reply templates; automatic expansion in a message composer is a separate capability. The image library stores references and descriptions: it does not upload, fetch or analyze remote files. Media URLs open only after an explicit user click. The history also records successful FAQ and bot settings changes. Legacy FAQ/settings writes and their history entries use sequential module transactions; material CRUD and its history use one atomic transaction. 

Bot settings include `themeColor` (`#RRGGBB`, default `#FF6600`) and `replySchedule` (`{mode: always|custom, start, end}` in `HH:MM`, Vietnam time, `[start, end)`, `end < start` spans midnight). Outside the reply hours the Meta inbox processor stores the message without answering, so staff handle it. Bot settings also include `autoResumeAfterManual` (default true), `humanTakeoverMinutes` (1–1440, default 5), and `silenceOnExternalReply` (default true). Old JSON settings receive these defaults on rehydration; partial updates never re-apply defaults to fields the client did not send. Partial updates leave unrelated handover values unchanged. The conversation module enforces these values on staff sends and Meta echoes.

The HTTP contract lives in `packages/contracts/src/bot/bot.routes.ts`; request/response schemas live in `packages/contracts/src/knowledge/knowledge.schema.ts`. Vietnamese and English labels are isolated in the `training` i18n namespace.
