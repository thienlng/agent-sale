import {
  MAX_CONVERSATION_NOTES,
  type ConversationNote,
  type ConversationView,
  type UpdateConversationRequest,
} from '@agent-sales/contracts';

/** List preview: the text, or a neutral marker the UI localizes (e.g. "[image]"). */
export function preview(text: string, attachments: readonly { type: string }[]): string {
  return text || (attachments[0] ? `[${attachments[0].type}]` : '');
}

/** A conversation opened by its first event; an echo (staff wrote first) does not open the 24-hour window. */
export function newConversation(input: {
  id: string;
  channelId: string;
  botId: string | null;
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
    botId: input.botId,
    provider: input.provider,
    // The raw id until the profile lookup finds a name.
    customerId: input.customerId,
    customerName: input.customerId,
    customerAvatarUrl: null,
    profileFetchedAt: null,
    mode: input.mode,
    autoResumeAt: null,
    takeover: null,
    status: 'open',
    starred: false,
    assigneeId: null,
    note: '',
    notes: [],
    unreadCount: 0,
    lastReadAt: null,
    lastReadBy: null,
    awaitingSince: null,
    lastMessageSender: input.echo ? 'human' : 'customer',
    customerPhone: null,
    lead: null,
    contactId: null,
    tags: [],
    revision: 0,
    lastMessage: '',
    lastInboundAt: input.echo ? new Date(0).toISOString() : input.occurredAt.toISOString(),
    createdAt: input.at,
    updatedAt: input.at,
  };
}

/** Appends to the timeline (oldest dropped past the cap); `note` mirrors the newest entry. */
export function withNote(c: ConversationView, entry: ConversationNote): ConversationView {
  return { ...c, note: entry.text, notes: [...c.notes, entry].slice(-MAX_CONVERSATION_NOTES) };
}

/** Staff control changes; every one is a new revision so pending bot replies are dropped. */
export function applyControlUpdate(
  c: ConversationView,
  input: UpdateConversationRequest,
  actorId: string,
  /** Timeline entry for a changed legacy `note` (built by the caller, which knows the author). */
  noteEntry?: ConversationNote,
  /** When the bot resumes for a temporary takeover (null: never); computed by the caller. */
  resumeAt: string | null = null,
): ConversationView {
  const base = noteEntry ? withNote(c, noteEntry) : c;
  return {
    ...base,
    ...(input.mode === 'bot' ? { mode: 'bot' as const, autoResumeAt: null, takeover: null } : {}),
    ...(input.mode === 'human'
      ? input.takeover === 'temporary'
        ? { mode: 'human' as const, autoResumeAt: resumeAt, takeover: 'temporary' as const }
        : { mode: 'human' as const, autoResumeAt: null, takeover: 'permanent' as const }
      : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.starred !== undefined ? { starred: input.starred } : {}),
    ...(input.note !== undefined && !noteEntry ? { note: input.note } : {}),
    ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone } : {}),
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
    // A new revision drops pending bot replies. `updatedAt` stays: the list is ordered by
    // conversation activity, and assigning, starring or filing must not move a row (INB-LST-04).
    revision: c.revision + 1,
  };
}
