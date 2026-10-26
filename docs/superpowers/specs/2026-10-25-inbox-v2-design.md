# Sales inbox v2 (T-073): design

Status: approved by the owner in chat on 2026-10-25. They approved part 1 (the list) and said "okk làm hết đi" for the rest, delegating the remaining decisions to the implementer.
UX reference: Pancake (pages.fm) docs and screenshots, researched on 2026-10-25. We use it as a reference, not a copy. Brand stays Rapiz orange.

## Problem (found in the T-068 inbox)

- The list shows Meta PSIDs instead of names. `receive()` stores `customerName = senderExternalId`, and nothing fetches the profile.
- There is no unread state, no "customer is waiting" state and no way to mark a conversation unread, so a sales rep taking over a shift cannot see what is still open.
- The bot/human control is a blind toggle. The three real states (bot, temporary takeover with auto-resume, permanent takeover) are hidden.
- "Nhân viên phụ trách trả lời" is the assignee, but each row only says "Đã giao/Chưa giao".
- Filters are permanently stacked blocks that waste space. Tags, the users' favourite tool, are absent from the inbox.
- The right panel shows technical data (customer id, duplicate channel and status) instead of what sales needs.

Principle: every element must answer a question a sales rep asks within two seconds:
- Who is waiting for me?
- Who is this customer?
- Who is answering, the bot or a person?
- What tags and stage does this conversation have?
- What do I do next?

Anything else is collapsed or removed.

## Decisions

### 1. Conversation list

```
🔍 Search name, phone, text…        [⚲ Lọc 2]
Tất cả 128 · Chưa đọc 12 · Chờ rep 5
[Có: Chốt đơn ×] [Không: Đã xử lý ×]      ← only while filtering, one scrollable line
(avatar)❷ (N)› Nguyễn Thu Hà        14:02   ← bold = unread, ❷ unread count, (N) assignee avatar
 ᶠ  Chị ơi son này còn k…           ⏱12p    ← channel glyph on avatar; wait time (red > 15 min)
    ▮Hỏi giá ▮VIP +2             📞 🤖      ← up to 3 tag chips + "+N"; phone captured; who answers
```

- **Tabs with counts:**
  - "Tất cả" lists everything.
  - "Chưa đọc" lists conversations whose unread count is above 0.
  - "Chờ rep" lists conversations with an `awaitingSince` time. The last customer message has not been answered by anyone, the bot included.
- **Preview line:** `↩ ` prefix when the last message came from the shop, `Bot: ` prefix when the bot sent it.
- **Filter popover:** one "Lọc" button with an active-count badge opens a two-column popover. The left column lists labelled groups; the right column holds the options. The groups are:
  - Tag: has (any or all), excludes, "Không gắn tag".
  - Trạng thái trả lời: chờ rep, đợi lâu nhất (sort by wait time), đã đọc nhưng chưa rep.
  - Ai đang trả lời: bot, người (taken over).
  - Người phụ trách: của tôi, chưa giao, a specific member.
  - Kênh.
  - Số điện thoại: có, không.
  - Trạng thái: đang mở, đã xong.

  Active filters show as removable chips on one line. Saved views (T-072) store the whole filter object.
- **Row menu:** right-click or the `⋯` button on hover offers mark unread or read, and assign.

### 2. Conversation pane

**Header (one line plus one sub-line)**
- Left: avatar, name, channel glyph and page name. The sub-line reads "Đã xem bởi Lan · 14:05", or "Chưa ai xem" in orange.
- Right:
  - **Reply-mode dropdown.** The button shows the current state:
    - "🤖 Bot đang trả lời".
    - "👤 Bạn đang tiếp quản · bot bật lại sau 4:12".
    - "👤 Người trả lời (bot tắt)".

    Opening it lists all options, each with a one-line explanation:
    - "Bot tự trả lời".
    - "Tiếp quản tạm thời — bot tự bật lại sau N phút" (N from the bot's `humanTakeoverMinutes`).
    - "Tiếp quản hẳn — bot không trả lời hội thoại này".

    The bot options are disabled, with a reason, when the channel has no active bot.
  - **Assignee dropdown:** avatar and name, or "Chưa giao". Opening it shows a searchable member list, "Giao cho tôi" and "Bỏ giao". This replaces the "Nhân viên phụ trách trả lời" row.
  - **"✓ Xong" / "Mở lại" button.**
  - **`⋯` menu:** mark unread, search in conversation, open on Facebook or Instagram.

**Thread**
- A "Tin mới" divider sits above the first message after `lastReadAt`.
- Bot messages carry a small "Bot" label. Human messages show the sending staff name when known.

**Tag bar** (one line directly above the composer; it replaces Pancake's always-on tag wall)
- The conversation's tags come first, as filled chips with `×`.
- Next come the most-used workspace tags that fit on the line, as outline chips. One click attaches a tag.
- "+ Tag" opens a searchable picker of all tags, which can also create a new tag.
- An expand chevron shows the full tag grid when wanted. The open or closed state is remembered per user in `localStorage`.
- Shortcut `T` opens the picker.

**Composer**
- Typing `/` at the start opens the existing quick replies, filtered by what follows the `/`.

**Opening a conversation**
- Opening a conversation marks it read for the whole shop. Shortcut `U` marks it unread again.

### 3. Right panel (each block earns its place, all blocks collapsible)

1. **Khách hàng:**
   - Avatar, name, channel and page.
   - Phone: detected from chat or from the linked contact, with copy and call.
   - Linked CRM contact, with link or create.
   - CRM stage, using the existing stage control.
2. **Ghi chú:** a timeline of notes (author, time, text), with the newest first and Enter to add. Notes are what a shift hands over, so the timeline replaces the single free-text note. The existing single note is migrated as the first entry.
3. **Đơn hàng:** the existing session orders and create order, kept compact.
4. **Hẹn chăm sóc lại:** the existing follow-up editor, collapsed into one line when no follow-up is set.

Removed: customer id (PSID), the duplicated channel and status fields.

### 4. Backend data (conversation module unless noted)

- **Customer profile:**
  - After the first inbound message, a best-effort job asks Meta for the name and avatar:
    - Messenger: `GET /{psid}?fields=first_name,last_name,profile_pic` with the page token.
    - Instagram: `GET /{igsid}?fields=name,username,profile_pic`.
  - The result is stored as `customerName` and `customerAvatarUrl`. A failure is ignored and retried at most once a day on later messages.
  - Until a name is known, the UI shows "Khách Facebook ·4821" (the last 4 digits of the PSID) instead of the raw id.
  - The fetch goes through `ChannelFacade` (`fetchCustomerProfile`). The conversation module never sees tokens.
- **Read state (shared by the whole shop):**
  - New fields: `unreadCount`, `lastReadAt`, `lastReadBy` (`{ userId, name }`).
  - Each inbound customer message adds one to `unreadCount`.
  - `POST /conversations/{id}/read` sets the count to 0 and records who read it.
  - `POST /conversations/{id}/unread` sets the count to at least 1 and clears `lastReadAt`.
- **Waiting state:** `awaitingSince` is set by an inbound message when it is null, and cleared when an outbound message (human or bot) is sent.
- **List metadata:**
  - `lastMessageSender` (`customer | human | bot`).
  - `customerPhone`: the last Vietnamese phone number found in an inbound text, with the regex in the domain.
  - `notes[]` (author, time, text; at most 200 entries).
- **Assignment:** `UpdateConversationRequest.assigneeId` (a uuid or null) sets any workspace member, checked through `TeamFacade`. `assignToMe` stays for compatibility.
- **Tags:**
  - Conversation-scope tags reuse the CRM tag library and `crm_tag_assignments` (`scope='conversation'`); the CRM module owns them.
  - New CRM routes: `GET|POST /conversations/{id}/tags` and remove through the existing assignment route.
  - New `CrmFacade` methods:
    - `conversationTags(ws, ids)` returns the tag chips for list rows.
    - `conversationIdsByTags(ws, filter)` handles include any/all, exclude and untagged.
- **List query:**
  - `ConversationListQuery` gains `tab`, `tagsAny`, `tagsAll`, `tagsExclude`, `untagged`, `assignee` (`me|none|<uuid>`), `channelId`, `hasPhone`, `waiting` (`any|longest|readNotReplied`) and `sort`.
  - The response adds `counts: { all, unread, waiting }` and per-row `tags`.
- **Storage:**
  - Migration `0024_inbox_v2.sql` adds real columns to `conversations` and backfills them from `data`:
    - `unread_count`
    - `awaiting_since`
    - `last_read_at`
    - `assignee_id`
    - `mode`
    - `status`
    - `customer_phone`
    - `created_at`
  - It also adds indexes for the tabs.
  - The store filters in SQL instead of loading every conversation into memory.

### 5. Out of scope (follow-ups)

- Round-robin or shift assignment.
- Bulk actions.
- Comment inbox.
- AI sentiment tags.
- Tag sync between a contact and its conversations.
- Per-user unread (the owner chose shared unread).

## Testing

- **Backend unit tests:**
  - Read and unread transitions.
  - Waiting set and clear, for human and bot replies.
  - Phone detection.
  - Profile fetch (fake Graph, failures ignored).
  - Assignee validation.
  - List filters and counts.
  - CRM conversation tags (any, all, exclude, untagged).
- **Integration tests:** the migration backfill, and RLS on the new columns (inherited from the table policy).
- **Web tests:**
  - Row anatomy (name fallback, unread, waiting, tags +N, prefixes).
  - The filter popover and chips.
  - The reply-mode dropdown (all options visible, disabled reasons).
  - The assignee dropdown.
  - The tag bar (attach, remove, picker).
  - Mark unread.
  - The `/` quick replies.
- `pnpm check` green. An independent QA agent reviews in parallel. The owner then runs a real-stack check on the integration branch.
