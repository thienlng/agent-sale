import type { ConversationView, InboxMessageDto } from '@agent-sales/contracts';

import type { SignalContext, SignalContextMessage } from '../api/conversation.facade.js';

/** At most this many messages go to one evaluation; older ones live in the rolling note. */
export const SIGNAL_CONTEXT_MAX_MESSAGES = 40;
/** …and at most this many characters of message text in total. */
export const SIGNAL_CONTEXT_MAX_CHARS = 8000;

const attachmentLabel = (m: InboxMessageDto): string =>
  m.attachments.length ? `[${m.attachments.map((a) => a.type).join(', ')}]` : '';

/**
 * The Business Brain's view of a conversation (spec 2026-11-11 §3.3): delivered or received
 * messages strictly after `after`, newest kept first when the 40-message / 8 000-character budget
 * runs out, returned oldest first. Failed or pending sends are left out: the customer never saw
 * them. Pure: the facade reads the conversation and its messages.
 */
export function buildSignalContext(
  c: ConversationView,
  messages: readonly InboxMessageDto[],
  after: Date | null,
): SignalContext {
  const since = after?.getTime() ?? Number.NEGATIVE_INFINITY;
  const picked: SignalContextMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || Date.parse(m.createdAt) <= since) break;
    if (m.status === 'failed' || m.status === 'pending') continue;
    const text = [m.text.trim(), attachmentLabel(m)].filter(Boolean).join(' ');
    if (!text) continue;
    if (picked.length >= SIGNAL_CONTEXT_MAX_MESSAGES) break;
    const room = SIGNAL_CONTEXT_MAX_CHARS - chars;
    if (room <= 0) break;
    const cut = text.length > room ? text.slice(text.length - room) : text;
    picked.push({ sender: m.sender, text: cut, at: m.createdAt });
    chars += cut.length;
  }
  const lastInbound = Date.parse(c.lastInboundAt) > 0 ? c.lastInboundAt : null;
  return {
    messages: picked.reverse(),
    facts: {
      status: c.status,
      contactId: c.contactId,
      assigneeId: c.assigneeId,
      customerName: c.customerName,
      awaitingSince: c.awaitingSince,
      lastInboundAt: lastInbound,
      lastMessageSender: c.lastMessageSender,
      isTest: false,
    },
  };
}
