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
        peekControl: async (id) => {
          const c = rows.get(`${ws}/${id}`);
          return c ? { mode: c.mode, status: c.status } : null;
        },
        findPeer: async (channel, customer) =>
          [...rows.entries()].find(
            ([key, c]) =>
              key.startsWith(`${ws}/`) && c.channelId === channel && c.customerId === customer,
          )?.[1] ?? null,
        awaitingReply: async ({ olderThan, limit }) => {
          const waiting = [...rows.entries()]
            .filter(([key]) => key.startsWith(`${ws}/`))
            .map(([, c]) => c)
            .filter(
              (c) =>
                c.status === 'open' &&
                c.awaitingSince !== null &&
                Date.parse(c.awaitingSince) <= olderThan.getTime(),
            )
            .sort(
              (a, b) =>
                Date.parse(a.awaitingSince ?? '') - Date.parse(b.awaitingSince ?? '') ||
                (a.id < b.id ? -1 : 1),
            );
          const byChannel = new Map<string, number>();
          for (const c of waiting) byChannel.set(c.provider, (byChannel.get(c.provider) ?? 0) + 1);
          return {
            count: waiting.length,
            oldestSince: waiting[0]?.awaitingSince
              ? new Date(waiting[0].awaitingSince).toISOString()
              : null,
            byChannel: [...byChannel]
              .map(([channel, count]) => ({ channel, count }))
              .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel)),
            ids: waiting.slice(0, Math.max(0, Math.min(limit, 200))).map((c) => c.id),
          };
        },
        aiTouches: async (points, windowMs) => {
          const delivered = (conv: string, sender: 'bot' | 'human') =>
            [...messages.entries()]
              .filter(([key]) => key.startsWith(`${ws}/`))
              .map(([, msg]) => msg)
              .filter(
                (msg) =>
                  msg.conversationId === conv &&
                  msg.direction === 'outbound' &&
                  msg.status === 'sent' &&
                  msg.sender === sender,
              )
              .map((msg) => Date.parse(msg.createdAt));
          return points.map((p) => {
            const to = p.at.getTime();
            const bot = delivered(p.conversationId, 'bot').filter(
              (t) => t >= to - windowMs && t < to,
            );
            if (!bot.length) return { firstBotAt: null, staffAfter: false };
            const first = Math.min(...bot);
            return {
              firstBotAt: new Date(first).toISOString(),
              staffAfter: delivered(p.conversationId, 'human').some((t) => t > first && t < to),
            };
          });
        },
        lastHumanAt: async (conversationId) => {
          const times = [...messages.entries()]
            .filter(([key]) => key.startsWith(`${ws}/`))
            .map(([, msg]) => msg)
            .filter(
              (msg) =>
                msg.conversationId === conversationId &&
                msg.sender === 'human' &&
                msg.direction === 'outbound' &&
                msg.status !== 'failed',
            )
            .map((msg) => Date.parse(msg.createdAt));
          return times.length ? new Date(Math.max(...times)).toISOString() : null;
        },
        todayCandidates: async ({
          ids,
          awaitingBefore,
          followUpBefore,
          limit,
          visibleTo,
          lastHumanFor,
        }) =>
          [...rows.entries()]
            .filter(([key]) => key.startsWith(`${ws}/`))
            .map(([, c]) => c)
            .filter((c) => !visibleTo || c.assigneeId === null || c.assigneeId === visibleTo)
            .filter(
              (c) =>
                ids.includes(c.id) ||
                (c.status === 'open' &&
                  c.awaitingSince !== null &&
                  Date.parse(c.awaitingSince) <= awaitingBefore.getTime()) ||
                (c.status !== 'spam' &&
                  !!c.followUpAt &&
                  Date.parse(c.followUpAt) <= followUpBefore.getTime()),
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, limit)
            .map((c) => {
              if (lastHumanFor && !lastHumanFor.includes(c.id))
                return { conversation: c, lastHumanReplyAt: null };
              const human = [...messages.entries()]
                .filter(([key]) => key.startsWith(`${ws}/${c.id}/`))
                .map(([, msg]) => msg)
                .filter((msg) => msg.sender === 'human' && msg.status !== 'failed')
                .map((msg) => msg.createdAt)
                .sort();
              return { conversation: c, lastHumanReplyAt: human[human.length - 1] ?? null };
            }),
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
        idsOfContact: async (contactId) =>
          [...rows.entries()]
            .filter(([key, c]) => key.startsWith(`${ws}/`) && c.contactId === contactId)
            .map(([, c]) => c.id),
        attachmentUrls: async (ids) =>
          [...messages.entries()]
            .filter(([key]) => ids.some((id) => key.startsWith(`${ws}/${id}/`)))
            .flatMap(([, msg]) => msg.attachments.map((a) => a.url)),
        erase: async (ids) => {
          const out = {
            conversations: 0,
            messages: 0,
            peers: [] as { channelId: string; customerId: string }[],
          };
          for (const id of ids) {
            const conv = rows.get(`${ws}/${id}`);
            if (!conv) continue;
            for (const key of [...messages.keys()])
              if (key.startsWith(`${ws}/${id}/`)) {
                out.messages += 1;
                messages.delete(key);
              }
            rows.delete(`${ws}/${id}`);
            out.conversations += 1;
            out.peers.push({ channelId: conv.channelId, customerId: conv.customerId });
          }
          return out;
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
