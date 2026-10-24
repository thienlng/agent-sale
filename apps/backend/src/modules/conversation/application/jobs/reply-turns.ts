import type { InboxMessageDto } from '@agent-sales/contracts';

export type ReplyTurn = { role: 'customer' | 'bot'; content: string };

const MAX_TURN_CHARS = 2000; // PlaygroundRequest.messages[].content limit

/** The model cannot open media, so the customer turn says so instead of silently dropping it. */
export function withAttachmentNote(text: string, attachments: readonly { type: string }[]): string {
  if (!attachments.length) return text;
  const images = attachments.filter((a) => a.type === 'image').length;
  const others = attachments.length - images;
  const notes = [images && `${images} ảnh`, others && `${others} tệp đính kèm`].filter(Boolean);
  const hint = images
    ? 'bạn không xem được hình ảnh, hãy nói rõ và nhờ khách mô tả hoặc nhân viên sẽ xem'
    : 'bạn không mở được tệp, hãy nói rõ và nhờ khách mô tả hoặc nhân viên sẽ xem';
  return `${text}\n[Khách đã gửi kèm ${notes.join(' và ')} — ${hint}]`.trim();
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
export function toReplyTurns(stored: readonly InboxMessageDto[]): ReplyTurn[] {
  const turns: ReplyTurn[] = [];
  let attempted = false;
  for (const m of stored) {
    if (m.direction === 'outbound') {
      attempted = true;
      if (m.status !== 'sent') continue;
    }
    const content = withAttachmentNote(m.text, m.attachments).slice(0, MAX_TURN_CHARS);
    if (!content.trim()) continue;
    const role = m.sender === 'customer' ? 'customer' : 'bot';
    const prev = turns.at(-1);
    if (role === 'customer' && prev?.role === 'customer' && !attempted)
      prev.content += `\n${content}`;
    else turns.push({ role, content });
    attempted = false;
  }
  for (const t of turns) t.content = t.content.slice(-MAX_TURN_CHARS);
  return turns.slice(-20);
}
