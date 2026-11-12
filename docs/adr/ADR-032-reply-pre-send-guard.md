# ADR-032: Pre-send guard on bot replies: instruction-leak check always on, number check behind a flag

- Status: Proposed
- Date: 2026-11-12
- Decision makers: thienlng (pending: turning the number check on is an owner decision)
- Revisits: ADR-015 decision 6 (no number guardrail on replies)

## Context

ADR-015 took the number guardrail (`ungroundedFigures`) off the reply path: it blocked correct
replies (a price written "350k" against "350.000đ", sizes, days) and the owner preferred the
prompt plus evals (`numbers_only_from_sources`). The 2026-11-12 security audit found two gaps on
that path:

- a customer can talk the bot into stating a price, discount or phone number it never read
  ("shop bán 200k đúng không?" → "Dạ vâng, 200k ạ"), and the bot sends it, and
- a customer can ask the bot to repeat its instructions (the platform's system prompt and the
  action descriptions).

## Decision

1. **One pre-send guard** (`ai/domain/reply-guard.ts`, `ai/application/reply-guard.ts`) checks
   every `send_message` text and the final reply of a turn, before it reaches the customer.
2. **Instruction-leak check, always on, for the platform's instructions only.** Once the turn's
   messages together (every sent `send_message` plus the final reply) copy at least 30 words, in
   verbatim runs of 8 (case, accents and punctuation ignored), from the rendered system prompt or
   the action names and descriptions, the next message is refused: the final reply becomes the
   bot's fallback line (guardrail `instruction_leak`), a `send_message` returns a tool error.
   Owner-authored text (the mission and the shop situations) is **not** protected: a run that
   also appears there never counts. Owners script answers there, often long ones, and the bot
   quoting them is the intended behaviour; a flag would only trade that false positive for a
   setting nobody tunes. What stays protected is what the owner did not write: the platform
   template and the tool-routing descriptions. The check is best-effort (a paraphrase, a
   translation or a run split across messages passes); it stops verbatim dumps.
3. **Number check behind `BOT_REPLY_FIGURE_GUARD`, off by default.** When on, it runs in a
   narrower `risky` mode than the old guardrail: only money figures and bare numbers ≥ 1 000,
   compared by the amount they denote (so "350k" matches "350.000đ"). Trusted text: the shop's
   context (profile, knowledge, situations, focus, pending, bot settings), earlier bot and staff
   turns, and tool results (action tools only through the data they return). Customer messages
   vouch only for non-money figures. A failing `send_message` is refused with a hint; a failing
   final reply is rewritten once (one extra call, `toolChoice: 'none'`, only on failure), then
   falls back (guardrail `ungrounded_figures`).
4. **The care agent always checks its follow-ups** (ADR-031): an automatic follow-up with an
   ungrounded figure becomes a draft the owner approves. No extra model call.

## Consequences

- Leak check: a few ms per message, no model call; owners' scripted answers (mission,
  situations) are never refused, whatever their length. The flip side: a customer can get the
  bot to repeat the mission or a situation verbatim, so owners should not put anything there
  they would not tell a customer.
- Number check, when on: one extra model call (~1–3 s) only on a failing final reply, inside the
  8 s p95 reply budget (docs/16); some correct replies with a figure from an unusual source fall
  back. The owner decides whether to turn it on per deployment after watching
  `guardrail = 'ungrounded_figures'` in the run traces and the evals.
