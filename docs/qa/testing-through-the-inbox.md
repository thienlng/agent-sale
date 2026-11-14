# Testing a shop through its inbox

The owner reviews bot quality by opening **Tin nhắn đa kênh** (the inbox) of a shop and reading the test
threads. "Chat thử" (the bot playground) and the eval runner (`pnpm --filter @agent-sales/backend eval`) leave
nothing in the inbox. A shop tested only that way looks untested, and the inbox path itself (thread list,
hand-off, staff takeover, the order or hold linked to the thread) stays unchecked.

**Rule:** every shop under test gets realistic customer conversations through a real channel, so they appear in
its inbox. Playground runs and evals come on top of that; they never replace it.

## 1. Give the shop a website channel

Never use a real Facebook Page or a customer's site for tests. Use a website channel on a test domain:

- In the dashboard: **Kênh → Website → Thêm website**. Use the name `Demo website (local test)`, the domain
  `demo.rapiz.test`, and the shop's bot.
- Or call the API as the owner: `POST /api/v1/channels/website` with
  `{ "name": "Demo website (local test)", "domains": ["demo.rapiz.test"], "botId": "<bot id>" }`.

The channel's site key (`wk_…`) is its `externalId`. It is also shown in the channel's install snippet.

On the local stack (2026-11-14), all four demo shops of `tester.assistant@rapiz.test` have such a channel:
TinyMind, Tam Dao Villas Central, Langmaster (demo) and Mailisa (demo).

## 2. Write the conversations

Write one JSON file per conversation, in Vietnamese, the way a real customer of that shop writes: short
messages, typos, no accents sometimes, and follow-up questions. Cover:

- the shop's everyday questions: price, stock or availability, delivery or location, opening hours, policies;
- the money path: an order to the end (TinyMind) or a hold to the end (villas), and a request for education and
  spa shops;
- 2–3 conversations that must be handed off: wholesale, complaint, refund, health, or a question the data
  cannot answer;
- 1–2 staff takeovers: the staff member takes over and replies from the inbox, then the customer writes again.

```json
{
  "title": "TinyMind – khách sỉ mầm non 30 bộ",
  "path": "san-pham",
  "maxWait": 180,
  "turns": [
    "chào shop, bên mình có bán sỉ cho trường mầm non k",
    "mình cần 30 bộ xếp hình gỗ, giá sỉ sao ạ",
    { "takeover": true },
    { "staff": "Dạ em là Hạnh bên TinyMind, em gửi chị bảng giá sỉ qua Zalo nhé ạ." },
    "ok em, sđt chị 0912345678"
  ]
}
```

## 3. Play them

Run one conversation at a time per shop. Staff steps use the newest website thread of the shop, so two scripts
running on the same shop would mix up their threads.

```bash
node scripts/qa/webchat-conversation.mjs \
  --site wk_… --script tinymind-01.json --out tinymind-01.md \
  --login ~/Workspace/rapiz-tester-account.txt --workspace <workspace id>
```

- `--login` and `--workspace` are needed only for `takeover` and `staff` steps.
- The script waits for the bot to finish each reply, up to `maxWait` seconds, and writes the transcript.
- The website abuse caps (docs/08 §4b) apply to tests too: 300 AI replies per site per hour, 10 holds and 30 orders
  a day per shop from visitors without a contact. A normal test session stays far below them; past a cap the
  visitor gets the hand-over message instead of an answer.
- Each customer turn costs 1–3 model calls. On Hermes (ChatGPT Plus), keep a session to about 200 calls and
  never run it alongside a model bench.

## 4. Check in the dashboard

Open **Tin nhắn đa kênh** of the shop:

- every conversation is in the list, under the website channel;
- hand-offs are waiting for staff, and the bot is paused in them;
- takeovers show the staff reply;
- orders (Đơn hàng) and holds (Lịch phòng) created by the bot are linked to their threads.

Report per shop: the number of inbox threads, the questions with a wrong answer and why (data or product bug),
and the findings, as in `docs/qa/release-staging/`.
