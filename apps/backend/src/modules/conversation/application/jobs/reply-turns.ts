import type { InboxMessageDto } from '@agent-sales/contracts';

export type ReplyTurn = { role: 'customer' | 'bot'; content: string };

const MAX_TURN_CHARS = 2000; // PlaygroundRequest.messages[].content limit

/**
 * Tells the model what accompanies the message. Images listed in `seen` are attached to the
 * request (vision); every other image or file is announced as something the model cannot open, so
 * it says so instead of pretending.
 */
export function withAttachmentNote(
  text: string,
  attachments: readonly { type: string; url?: string }[],
  seen: ReadonlySet<string> = new Set(),
  answered = false,
): string {
  if (!attachments.length) return text;
  // Pictures from an earlier, already answered turn are history: the bot did get to look at them
  // then, so it must not claim it cannot see images.
  if (answered && attachments.every((a) => a.type === 'image'))
    return `${text}\n[Khách đã gửi kèm ${attachments.length} ảnh ở lượt trước]`.trim();
  const isSeen = (a: { type: string; url?: string }) =>
    a.type === 'image' && a.url !== undefined && seen.has(a.url);
  const visible = attachments.filter(isSeen).length;
  const images = attachments.filter((a) => a.type === 'image' && !isSeen(a)).length;
  const others = attachments.filter((a) => a.type !== 'image').length;
  const notes: string[] = [];
  if (visible)
    notes.push(
      `Khách đã gửi kèm ${visible} ảnh — ảnh được đính kèm cho bạn xem, hãy dùng ảnh để hiểu khách muốn nói gì`,
    );
  if (images || others) {
    const what = [images && `${images} ảnh`, others && `${others} tệp đính kèm`]
      .filter(Boolean)
      .join(' và ');
    const hint = images
      ? 'bạn không xem được hình ảnh, hãy nói rõ và nhờ khách mô tả hoặc nhân viên sẽ xem'
      : 'bạn không mở được tệp, hãy nói rõ và nhờ khách mô tả hoặc nhân viên sẽ xem';
    notes.push(`Khách đã gửi kèm ${what} — ${hint}`);
  }
  return `${text}\n${notes.map((n) => `[${n}]`).join('\n')}`.trim();
}

/**
 * Chat turns for the model from messages already in arrival order. Consecutive customer messages
 * (a burst, or text followed by an image) become ONE turn joined by newlines, so the model sees
 * every question after the last bot/staff reply as a single customer turn instead of answering
 * only the newest one. Bot and staff messages stay separate turns.
 *
 * An outbound message of ANY status ends the merge: a reply that failed, is pending or has an
 * unknown outcome still counts as an attempt to answer what came before it. Only text that was
 * actually sent is shown to the model as an assistant turn.
 */
export function toReplyTurns(
  stored: readonly InboxMessageDto[],
  seen: ReadonlySet<string> = new Set(),
): ReplyTurn[] {
  return toTimedReplyTurns(stored, seen).turns;
}

/**
 * `toReplyTurns` plus, for each turn, when its newest message was stored (same length and
 * order), so the ai module can reuse the stored conversation summary across turns.
 */
export function toTimedReplyTurns(
  stored: readonly InboxMessageDto[],
  seen: ReadonlySet<string> = new Set(),
): { turns: ReplyTurn[]; times: Date[] } {
  const turns: ReplyTurn[] = [];
  const times: Date[] = [];
  let attempted = false;
  const lastOutbound = stored.findLastIndex((m) => m.direction === 'outbound');
  for (const [index, m] of stored.entries()) {
    if (m.direction === 'outbound') {
      attempted = true;
      if (m.status !== 'sent') continue;
    }
    const content = withAttachmentNote(
      m.text,
      m.attachments,
      seen,
      m.direction === 'inbound' && index < lastOutbound,
    ).slice(0, MAX_TURN_CHARS);
    if (!content.trim()) continue;
    const role = m.sender === 'customer' ? 'customer' : 'bot';
    const prev = turns.at(-1);
    // Customer bursts are one turn; so are the bubbles of one bot answer (sent as separate messages).
    const at = new Date(m.createdAt);
    if (
      (role === 'customer' && prev?.role === 'customer' && !attempted) ||
      (role === 'bot' && prev?.role === 'bot')
    ) {
      prev.content += `\n${content}`;
      times[times.length - 1] = at;
    } else {
      turns.push({ role, content });
      times.push(at);
    }
    attempted = false;
  }
  for (const t of turns) t.content = t.content.slice(-MAX_TURN_CHARS);
  return { turns: turns.slice(-20), times: times.slice(-20) };
}
