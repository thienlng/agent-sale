# Bot training workspace

The bot workspace keeps a persistent training menu alongside the existing test chat. Its sections are home, products, instructions, information/FAQ, integrations, image library, bot setup, quick replies and edit history. Below desktop widths the menu scrolls horizontally and the test chat opens in a sheet.

Products reuse the workspace's operational commerce catalog, including its `visibleToBot` flag and optional `botInstructions` guidance (up to 4000 characters). They are not copied into a separate bot catalog. Integrations link to the workspace channel connection flow. FAQ and settings retain their existing APIs.

## Training materials

The knowledge module owns `training_items` and `training_history` (migration `0006_training.sql`). The bot module exposes the HTTP routes and verifies bot ownership before calling the knowledge facade. Every route requires authentication and workspace membership. Queries use a workspace transaction and forced row level security. Material writes and history insertion commit together.

- `GET /api/v1/bots/{botId}/training-items`: up to 500 materials, newest updates first.
- `POST /api/v1/bots/{botId}/training-items`: create a material.
- `PATCH /api/v1/bots/{botId}/training-items/{itemId}`: edit a material without changing its kind.
- `DELETE /api/v1/bots/{botId}/training-items/{itemId}`: delete a material; preserve its history.
- `GET /api/v1/bots/{botId}/training-history`: latest 100 material changes.

A material has `kind` (`scenario`, `quick_reply`, `media`), `title` (1–160 characters), `content` (1–8000), `trigger` (0–500) and nullable `mediaUrl` (HTTPS only, up to 2000 characters). Boundary validation trims text and rejects empty updates. History stores action, title and kind (materials, FAQ or settings), record ID and timestamp; it does not copy the material body. Bot ownership and workspace isolation also apply to history.

Instruction scenarios provide guidance for bot generation through the knowledge public API. Quick replies are saved team reply templates; automatic expansion in a message composer is a separate capability. The image library stores references and descriptions: it does not upload, fetch or analyze remote files. Media URLs open only after an explicit user click. The history also records successful FAQ and bot settings changes. Legacy FAQ/settings writes and their history entries use sequential module transactions; material CRUD and its history use one atomic transaction. The current history does not attribute edits to a named staff member.

Bot settings include `autoResumeAfterManual` (default true), `humanTakeoverMinutes` (1–1440, default 5), and `silenceOnExternalReply` (default true). Old JSON settings receive these defaults on rehydration. Partial updates leave unrelated handover values unchanged. The conversation module enforces these values on staff sends and Meta echoes.

The HTTP contract lives in `packages/contracts/src/bot/bot.routes.ts`; request/response schemas live in `packages/contracts/src/knowledge/knowledge.schema.ts`. Vietnamese and English labels are isolated in the `training` i18n namespace.
