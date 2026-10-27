import type { WorkspaceId } from '@agent-sales/shared';

import type {
  VisitorMessageContext,
  VisitorRecord,
  VisitorStore,
} from '../../application/ports/visitor-store.js';

export class MemoryVisitorStore implements VisitorStore {
  readonly rows = new Map<string, VisitorRecord>();

  async recordMessage(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    context: VisitorMessageContext,
  ) {
    const now = new Date().toISOString();
    const existing = this.rows.get(visitorId);
    if (existing) {
      this.rows.set(visitorId, {
        ...existing,
        lastUrl: context.lastUrl,
        lastTitle: context.lastTitle,
        lastSeenAt: now,
      });
      return;
    }
    this.rows.set(visitorId, {
      id: visitorId,
      workspaceId: ws,
      connectionId,
      conversationId: null,
      firstUrl: context.firstUrl,
      referrer: context.referrer,
      lastUrl: context.lastUrl,
      lastTitle: context.lastTitle,
      phoneE164: null,
      contactId: null,
      messageCount: 0,
      createdAt: now,
      lastSeenAt: now,
    });
  }

  async find(ws: WorkspaceId, connectionId: string, visitorId: string) {
    const r = this.rows.get(visitorId);
    return r && r.workspaceId === ws && r.connectionId === connectionId ? r : null;
  }

  async countMessage(ws: WorkspaceId, connectionId: string, visitorId: string) {
    const r = await this.find(ws, connectionId, visitorId);
    if (r) this.rows.set(visitorId, { ...r, messageCount: r.messageCount + 1 });
  }

  async recordPhone(
    ws: WorkspaceId,
    connectionId: string,
    visitorId: string,
    phoneE164: string,
    contactId: string,
  ) {
    const r = await this.find(ws, connectionId, visitorId);
    if (r) this.rows.set(visitorId, { ...r, phoneE164, contactId });
  }

  async linkConversation(ws: WorkspaceId, connectionId: string, visitorId: string, id: string) {
    const r = await this.find(ws, connectionId, visitorId);
    if (r && !r.conversationId) this.rows.set(visitorId, { ...r, conversationId: id });
  }
}
