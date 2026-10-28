import type { ConversationView, InboxMessageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type {
  ConversationStore,
  ConversationTx,
} from '../../application/ports/conversation-store.js';
import { filterConversations } from '../../domain/conversation-filter.js';
/** Serialized test UoW with rollback; deliberately not used as a production fallback. */
export class MemoryConversationStore implements ConversationStore {
  private rows = new Map<string, ConversationView>();
  private messagesByKey = new Map<string, InboxMessageDto>();
  private tail: Promise<unknown> = Promise.resolve();
  readonly events: unknown[] = [];
  run<T>(ws: WorkspaceId, fn: (tx: ConversationTx) => Promise<T>): Promise<T> {
    const execute = async () => {
      const rows = new Map(structuredClone([...this.rows])),
        messages = new Map(structuredClone([...this.messagesByKey]));
      const events: unknown[] = [];
      const result = await fn({
        lockPeer: async () => undefined,
        find: async (id) => rows.get(`${ws}/${id}`) ?? null,
        findPeer: async (channel, customer) =>
          [...rows.entries()].find(
            ([key, c]) =>
              key.startsWith(`${ws}/`) && c.channelId === channel && c.customerId === customer,
          )?.[1] ?? null,
        query: async (filter) =>
          filterConversations(
            [...rows.entries()].filter(([key]) => key.startsWith(`${ws}/`)).map(([, c]) => c),
            filter,
          ),
        save: async (c) => {
          rows.set(`${ws}/${c.id}`, structuredClone(c));
        },
        messages: async (id) =>
          [...messages.entries()]
            .filter(([key]) => key.startsWith(`${ws}/${id}/`))
            .map(([, m]) => m)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        peerMessagesAfter: async (channel, customer, after, limit) => {
          const conv = [...rows.entries()].find(
            ([key, c]) =>
              key.startsWith(`${ws}/`) && c.channelId === channel && c.customerId === customer,
          )?.[1];
          if (!conv) return { conversationId: null, messages: [] };
          return {
            conversationId: conv.id,
            messages: [...messages.entries()]
              .filter(([key]) => key.startsWith(`${ws}/${conv.id}/`))
              .map(([, m]) => m)
              .filter((m) => !after || m.id > after)
              .sort((a, b) => (a.id < b.id ? -1 : 1))
              .slice(0, limit),
          };
        },
        findMessage: async (id, key) => messages.get(`${ws}/${id}/${key}`) ?? null,
        saveMessage: async (m, key) => {
          messages.set(`${ws}/${m.conversationId}/${key}`, structuredClone(m));
        },
        updateMessage: async (m) => {
          for (const [key, stored] of messages)
            if (key.startsWith(`${ws}/`) && stored.id === m.id)
              messages.set(key, structuredClone(m));
        },
        audit: async (id, type, payload) => {
          events.push({ id, type, payload });
        },
        releaseBot: async (botId) => {
          for (const [key, row] of rows)
            if (key.startsWith(`${ws}/`) && row.botId === botId)
              rows.set(key, { ...row, botId: null });
        },
      });
      this.rows = rows;
      this.messagesByKey = messages;
      this.events.push(...events);
      return result;
    };
    const result = this.tail.then(execute);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
