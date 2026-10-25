import type { ConversationView, UpdateConversationRequest } from '@agent-sales/contracts';

/** List preview: the text, or a neutral marker the UI localizes (e.g. "[image]"). */
export function preview(text: string, attachments: readonly { type: string }[]): string {
  return text || (attachments[0] ? `[${attachments[0].type}]` : '');
}

/** A conversation opened by its first event; an echo (staff wrote first) does not open the 24-hour window. */
export function newConversation(input: {
  id: string;
  channelId: string;
  provider: ConversationView['provider'];
  customerId: string;
  mode: ConversationView['mode'];
  echo: boolean;
  occurredAt: Date;
  at: string;
}): ConversationView {
  return {
    id: input.id,
    channelId: input.channelId,
    provider: input.provider,
    // The raw id until the profile lookup finds a name.
    customerId: input.customerId,
    customerName: input.customerId,
    customerAvatarUrl: null,
    profileFetchedAt: null,
    mode: input.mode,
    autoResumeAt: null,
    status: 'open',
    assigneeId: null,
    note: '',
    notes: [],
    unreadCount: 0,
    lastReadAt: null,
    lastReadBy: null,
    awaitingSince: null,
    lastMessageSender: input.echo ? 'human' : 'customer',
    customerPhone: null,
    tags: [],
    revision: 0,
    lastMessage: '',
    lastInboundAt: input.echo ? new Date(0).toISOString() : input.occurredAt.toISOString(),
    createdAt: input.at,
    updatedAt: input.at,
  };
}

/** Staff control changes; every one is a new revision so pending bot replies are dropped. */
export function applyControlUpdate(
  c: ConversationView,
  input: UpdateConversationRequest,
  actorId: string,
  at: string,
): ConversationView {
  return {
    ...c,
    ...(input.mode ? { mode: input.mode, autoResumeAt: null } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.followUpAt !== undefined ? { followUpAt: input.followUpAt } : {}),
    ...(input.followUpNote !== undefined
      ? { followUpNote: input.followUpNote }
      : input.followUpAt === null
        ? { followUpNote: '' }
        : {}),
    // An explicit assignee wins over the "assign to me" shortcut.
    ...(input.assigneeId !== undefined
      ? { assigneeId: input.assigneeId }
      : input.assignToMe !== undefined
        ? { assigneeId: input.assignToMe ? actorId : null }
        : {}),
    revision: c.revision + 1,
    updatedAt: at,
  };
}
