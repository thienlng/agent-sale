import { roleCan, type ConversationView } from '@agent-sales/contracts';
import { notificationStrings } from '@agent-sales/i18n/notification';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { NOTIFICATION_FACADE, type NotificationFacade } from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';

/** One alert per conversation and recipient per window: a burst of messages pushes once. */
export const INBOX_ALERT_WINDOW_MS = 5 * 60_000;
const EXCERPT_MAX = 120;
/** Never fan out to a whole crowd: the first members (owner first) are enough to react. */
const MAX_RECIPIENTS = 20;

export type InboxAlertKind = 'handoff' | 'message';

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1)}…` : flat;
}

/**
 * Staff alerts from the inbox (T-190): the bot handed a conversation to staff, or a customer wrote
 * in a conversation staff are handling. Goes to the assignee, else to every active member who
 * replies to customers (`contacts.edit`), in-app and as a push to their devices. Best effort: an
 * alert never fails the inbox operation that raised it; logs carry ids and error classes only.
 */
@Injectable()
export class InboxAlerts {
  readonly #log = new Logger('InboxAlerts');

  constructor(
    @Optional() @Inject(NOTIFICATION_FACADE) private readonly notifications?: NotificationFacade,
    @Optional() @Inject(WORKSPACE_FACADE) private readonly workspaces?: WorkspaceFacade,
    private readonly now: () => number = Date.now,
  ) {}

  async raise(
    ws: WorkspaceId,
    c: Pick<
      ConversationView,
      'id' | 'customerName' | 'assigneeId' | 'revision' | 'lastMessage' | 'status'
    >,
    kind: InboxAlertKind,
    text?: string,
  ): Promise<void> {
    if (!this.notifications || !this.workspaces || c.status === 'spam') return;
    try {
      const [accountId, members, workspace] = await Promise.all([
        this.workspaces.accountOf(ws),
        this.workspaces.listMembers(ws),
        this.workspaces.getById(ws),
      ]);
      if (!accountId) return;
      const active = members.filter((m) => m.status === 'active');
      const assignee = c.assigneeId ? active.find((m) => m.userId === c.assigneeId) : undefined;
      const recipients = assignee
        ? [assignee]
        : active
            .filter((m) => roleCan(m.role, 'contacts.edit'))
            .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
            .slice(0, MAX_RECIPIENTS);
      const bucket =
        kind === 'handoff' ? c.revision : Math.floor(this.now() / INBOX_ALERT_WINDOW_MS);
      for (const m of recipients) {
        const locale = await this.notifications.recipientLocale(m.userId as UserId);
        const s = notificationStrings(locale);
        const vars = {
          customer: excerpt(c.customerName) || '—',
          business: workspace.name,
          excerpt: excerpt(text ?? c.lastMessage),
        };
        await this.notifications.notify({
          accountId,
          userId: m.userId,
          workspaceId: ws,
          type: kind === 'handoff' ? 'inbox.handoff' : 'inbox.message',
          params: { conversationId: c.id },
          title: fill(s[`inbox.${kind}.title`] ?? '', vars).slice(0, 160),
          body: fill(s[`inbox.${kind}.body`] ?? '', vars).slice(0, 4000),
          target: { kind: 'conversation', conversationId: c.id },
          channels: ['in_app', 'push'],
          dedupKey: `inbox:${c.id}:${bucket}`,
        });
      }
    } catch (e) {
      this.#log.warn(
        `inbox alert for conversation ${c.id} not raised (${e instanceof Error ? e.name : 'unknown'})`,
      );
    }
  }
}
