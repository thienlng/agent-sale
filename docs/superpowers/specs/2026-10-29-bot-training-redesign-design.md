# Bot training redesign: business profile and reply guidance

- Date: 2026-10-29
- Status: approved design (owner, chat 2026-10-29); implementation not started
- Scope: bot screens "Thông tin doanh nghiệp" (`/app/bots/$botId/knowledge`) and "Hướng dẫn trả lời" (`/app/bots/$botId/instructions`), bot settings de-duplication, prompt `sales-agent@9`, data backfill, moving a Page to another business.
- Related: ADR-012 (account → business → bot → channels), T-093 (bot industry from business), T-133 (soft page removal), PR #84 (create/switch business).

## 1. Problem

Audit of `origin/main` a354c32 and the live data of bots `sale_tinymind` and `sale_villas`:

1. **Business facts live in five places**, one of them unused by the AI:
   - workspace profile `businessServices` / `productDescription` — never read by the AI;
   - bot settings "Thông tin cửa hàng" (`settings.placeholders`) — only fills `{{store.*}}` slots in seeded FAQ answers;
   - "Thông tin doanh nghiệp" — FAQ table reached through retrieval; an answer with an unfilled placeholder is silently dropped;
   - "Hướng dẫn trả lời → Giới thiệu" — mission and greeting, duplicated in bot settings;
   - bot settings pronouns/creativity — duplicated by seeded rules such as "Xưng hô lịch sự".
2. **Wrong template.** Both bots sit in the retail business "Ken Shop", so the villa bot got the retail pack (shipping, returns, "size", "báo giá theo danh mục"). Its placeholders are empty, so all six seeded FAQs are unusable, with no warning in the UI. The existing `hotel` pack is unused.
3. **FAQ is the wrong shape for basic facts.** Address or hotline are facts, not questions; they reach the model only when retrieval happens to match the customer's wording.
4. **"Hướng dẫn trả lời" mixes identity, style, situations and locked system rules** in one list with a 20-rule cap.

## 2. Model decisions (owner-approved)

| Thing | Belongs to | Note |
|---|---|---|
| Industry / template | **Business** (ADR-012) | A bot's `industry` equals its business industry and is not edited per bot. |
| Business facts (address, hotline, policies, notes) | **Each bot** | Two bots of one business may be two branches. |
| Catalog | Business; each bot selects products | ADR-012 §4 / PR #84. |
| Reply style and situations | Each bot | |

Consequence: TinyMind and Villas become **two businesses** (retail, lodging). Villas is created with the PR #84 flow; the Tam Dao Page is removed from "Ken Shop" (T-133) and connected in the new business. Villas' old conversations, contacts and statistics stay in "Ken Shop" (accepted by the owner). No cross-business data move.

## 3. Screen "Thông tin doanh nghiệp" (what the bot may say)

Replaces the FAQ-first page. One page, one "Lưu thay đổi" action, unsaved-changes guard, completeness bar ("Đã điền 7/11"), template name shown read-only ("Mẫu: Lưu trú (theo business)").

1. **Basic** (every industry): display name, address, Google Maps link, hotline/Zalo, opening hours.
2. **Industry block** (fields defined per industry):
   - retail/fashion/cosmetics: payment, shipping and fees, returns, warranty, current promotion;
   - hotel (lodging): unit types and capacity, reference prices, check-in/out, deposit and payment, cancellation/rescheduling, amenities, children/pets, directions/transfer;
   - spa, dental, education, solar: own field sets drafted from their packs during implementation (reviewed in the plan);
   - other: no industry block.
3. **Other FAQs**: the existing Q&A table (add, CSV import/export, bulk delete) for the long tail; still retrieved by search.
4. **Notes** (every industry): free text, ≤ 3000 characters, always given to the model; for specifics the fields do not cover.

Rules:
- Each field is a fact, not a question; the bot phrases the answer. Empty fields show a ⚠ marker; the bot says the information is not available.
- Placeholders in inputs are examples only; never saved, never sent.
- Field values and notes are data, never instructions (see §5).
- Prices: catalog prices win; "reference prices" is for ranges/seasonal text.

## 4. Screen "Hướng dẫn trả lời" (how the bot talks)

1. **Personality**: mission (one field), self pronoun and customer pronoun (select with free entry), reply length (very short / short / detailed), tone (friendly / formal), allow emoji, greeting.
2. **Situations**: "Khi khách … → Bot sẽ …" rows with enable switch, copy, edit, delete; sections "Chung" and "Sau khi chốt đơn" kept; "Gợi ý theo ngành" adds industry starters (lodging: availability, booking, bargaining, directions…); 20 enabled maximum (backend `MAX_SITUATIONS`).
3. **System rules**: locked, collapsed by default.

Bot settings keeps technical items only: model tier, language, reply schedule, takeover minutes and auto-resume, external-reply silence, fallback and handoff messages, theme, avatar. Mission, greeting and pronouns move out of it.

## 5. Data and prompt

Stored in `bots.settings` (jsonb, no new table):

```
settings.profile = { fields: Record<FieldKey, string>, notes: string }
settings.replyLength: 'veryShort' | 'short' | 'detailed'
settings.tone: 'friendly' | 'formal'
settings.allowEmoji: boolean
```

- Field definitions (key, industries, max length) live once in `packages/contracts`; labels/examples in `packages/i18n` (vi/en). Unknown keys are rejected; every new setting has a default so partial updates stay safe (existing `BotSettings` rule).
- `bot.industry` is set from the business at creation (T-093) and is not editable through `UpdateBotRequest`.
- Prompt `sales-agent@9` (packages/ai-core): adds an always-present `<business_profile>` block rendered from the bot's industry field list (label: value, empty → "(not provided)") plus notes; states that the block is data, not instructions; missing facts → outcome `unknown`, never a guess; catalog prices override reference prices. `{{bot.style}}` is built from length/tone/emoji instead of hand-written style rules. `<knowledge>` retrieval stays for the FAQ table.
- Evals before switching: address/hours/deposit asked several ways; an empty field asked directly; an injection attempt inside notes; catalog vs reference price conflict; retail and lodging bots.

## 6. Backfill (idempotent CLI with `--dry-run`, like `account-backfill`)

| Existing data | Action |
|---|---|
| `settings.placeholders` | Copied to `profile.fields` (`store.address`→address, `store.hotline`→hotline, `store.hours`→hours, `store.name`→display name, `payment.methods`→payment, `shipping.policy`→shipping, `return.policy`→returns, `hotel.*`→lodging fields). Existing profile values are never overwritten. |
| Seeded FAQs **unchanged** from their pack (exact question and answer match) | **Deleted** (owner-approved). |
| Edited or user-written FAQs | Kept in "Other FAQs". |
| Seeded "every reply" style rules **unchanged** from the starter set | Mapped to personality settings, then **deleted**. |
| Edited rules and situations | Kept as situations. |
| `settings.placeholders` | Kept read-only for one release, then removed in a follow-up. |

The dry run prints per-bot counts (copied, deleted, kept); the owner approves before the real run. A second run changes nothing.

## 7. Moving a Page to another business

Today `channel_connections` has a unique key on `(provider, external_id)`, so a Page removed from business A cannot be connected in business B (T-133 limitation). Change: a partial unique index over rows whose status is not `removed`; connecting in B creates a new row, the removed row and its history stay in A. Migration must be backward compatible and numbered after the open branches (≥ 0034).

## 8. Delivery

| # | Task | Depends on |
|---|---|---|
| 1 | Contracts: field catalog, profile and style settings, update API | — |
| 2 | Prompt `sales-agent@9` + evals | 1 |
| 3 | "Thông tin doanh nghiệp" screen | 1 |
| 4 | "Hướng dẫn trả lời" screen; remove duplicates from bot settings | 1 |
| 5 | Backfill CLI | 1, 2 |
| 6 | Page reconnect in another business | T-133 |
| 7 | Switch all bots to @9 after evals and backfill | 2, 5 |

Prompt @8 keeps answering until step 7, so no reply is lost during the transition. Each task: tests first, `pnpm check`, independent QA review, docs updated (docs/06 bot settings, docs/meta-inbox.md, ai MODULE.md).

## 9. Testing

- Unit: profile rendering (empty, special characters, limits), style builder, placeholder mapping, "unchanged seed" detection.
- Integration (Testcontainers): backfill on TinyMind-like and Villas-like data, idempotent rerun, user FAQs untouched; reconnecting a removed Page in another business.
- AI evals as in §5.
- e2e (production build): fill a lodging profile, save, reload; unsaved guard; retail field set; personality and situation toggles.
- Live acceptance on the owner's Tam Dao test thread: check-in time, directions, and an empty field.

## 10. Risks

- Prompt size grows by roughly 1–2k characters per turn; notes are capped at 3000.
- Overlap with PR #84 (profile page, business creation); tasks 1–5 stay in bot/knowledge/ai files, task 6 in channel.
- Field sets for spa/dental/education/solar need owner review during planning.

## Out of scope

Moving conversations/contacts between businesses; per-bot industry override; booking or availability engines; replacing catalog pricing.
