import type { WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { INBOX_ALERT_WINDOW_MS, InboxAlerts } from '../application/inbox-alerts.js';

import type { NotificationFacade } from '../../notification/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';

const WS = '01a1a476-8076-74f6-bd65-49b32c66b614' as WorkspaceId;
const CONV = '01a1a476-8076-74f6-bd65-49b32c66b615';
const member = (userId: string, role: string, status: 'active' | 'removed' = 'active') => ({
  userId,
  role,
  status,
  joinedAt: new Date(),
});

function setup(
  members = [
    member('owner', 'owner'),
    member('sale', 'sales'),
    member('ana', 'analyst'),
    member('gone', 'care', 'removed'),
  ],
) {
  const notify = vi.fn(async () => ({ id: 'n', deduped: false }));
  const notifications = {
    notify,
    recipientLocale: vi.fn(async () => 'vi' as const),
  } as unknown as NotificationFacade;
  const workspaces = {
    accountOf: vi.fn(async () => 'acc'),
    listMembers: vi.fn(async () => members),
    getById: vi.fn(async () => ({ name: 'Langmaster' })),
  } as unknown as WorkspaceFacade;
  const now = INBOX_ALERT_WINDOW_MS * 1000 + 5;
  return { notify, alerts: new InboxAlerts(notifications, workspaces, () => now), now };
}

const conv = (over: Record<string, unknown> = {}) => ({
  id: CONV,
  customerName: 'Trần   Thu Trang',
  assigneeId: null,
  revision: 7,
  lastMessage: 'cho chị gặp nhân viên',
  status: 'open' as const,
  ...over,
});

describe('InboxAlerts', () => {
  it('alerts every active member who replies to customers, in-app and by push', async () => {
    const { notify, alerts } = setup();
    await alerts.raise(WS, conv(), 'handoff');
    expect(notify.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).toEqual([
      'owner',
      'sale',
    ]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc',
        workspaceId: WS,
        type: 'inbox.handoff',
        title: 'Trần Thu Trang cần nhân viên hỗ trợ',
        body: 'Langmaster · cho chị gặp nhân viên',
        target: { kind: 'conversation', conversationId: CONV },
        channels: ['in_app', 'push'],
        dedupKey: `inbox:${CONV}:7`,
      }),
    );
  });

  it('alerts only the assignee, once per conversation per 5-minute window', async () => {
    const { notify, alerts } = setup();
    await alerts.raise(WS, conv({ assigneeId: 'sale' }), 'message', 'a'.repeat(300));
    expect(notify).toHaveBeenCalledTimes(1);
    const input = (notify.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(input['userId']).toBe('sale');
    expect(input['type']).toBe('inbox.message');
    expect(input['title']).toBe('Tin nhắn mới từ Trần Thu Trang');
    expect(input['body']?.length).toBeLessThanOrEqual('Langmaster · '.length + 120);
    expect(input['dedupKey']).toBe(`inbox:${CONV}:1000`);
  });

  it('stays quiet for spam and never throws', async () => {
    const { notify, alerts } = setup();
    await alerts.raise(WS, conv({ status: 'spam' }), 'message');
    expect(notify).not.toHaveBeenCalled();
    notify.mockRejectedValueOnce(new Error('db down'));
    await expect(alerts.raise(WS, conv(), 'handoff')).resolves.toBeUndefined();
  });

  it('tells only the owners that AI replies to new website visitors are capped, once per window', async () => {
    const { notify, alerts } = setup();
    await alerts.aiCapped(WS, { scope: 'workspace', window: 'day', windowStart: 86_400_000 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        type: 'inbox.ai_capped',
        title: 'AI tạm dừng trả lời khách mới trên website',
        body: expect.stringContaining('Langmaster · Doanh nghiệp đã hết lượt AI') as string,
        target: { kind: 'path', path: '/app/inbox' },
        dedupKey: `inbox-capped:${WS}:workspace:day:86400000`,
      }),
    );
    const body = (notify.mock.calls[0] as unknown as [{ body: string }])[0].body;
    expect(body).toContain('trong ngày này');
    notify.mockRejectedValueOnce(new Error('db down'));
    await expect(
      alerts.aiCapped(WS, { scope: 'site', window: 'hour', windowStart: 0 }),
    ).resolves.toBeUndefined();
  });
});
