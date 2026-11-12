import { describe, expect, it } from 'vitest';

import type { NotificationFacade, NotifyInput } from '../../notification/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type {
  DueTaskReminder,
  TaskReminderStore,
} from '../application/ports/task-reminder-store.js';
import { MAX_REMINDER_FAILURES, TaskReminderRunner } from '../application/task-reminder.runner.js';

const ws = '018d0000-0000-7000-8000-000000000001';
const assignee = '018d0000-0000-7000-8000-00000000000a';
const removed = '018d0000-0000-7000-8000-00000000000b';
const now = new Date('2026-11-11T03:00:00.000Z');

interface Row extends DueTaskReminder {
  remindedAt: Date | null;
  status: 'open' | 'done';
}

function setup(rows: Row[]) {
  const store: TaskReminderStore = {
    async due(at, limit) {
      return rows
        .filter((r) => r.status === 'open' && !r.remindedAt && r.dueAt <= at)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async markReminded(task, at) {
      const row = rows.find((r) => r.id === task.id);
      if (
        row &&
        !row.remindedAt &&
        row.dueAt.getTime() === task.dueAt.getTime() &&
        row.assigneeUserId === task.assigneeUserId
      )
        row.remindedAt = at;
    },
  };
  const sent: NotifyInput[] = [];
  const notifications = {
    async notify(i: NotifyInput) {
      sent.push(i);
      return { id: crypto.randomUUID(), deduped: false };
    },
    async recipientLocale() {
      return 'vi' as const;
    },
  } as unknown as NotificationFacade;
  const workspaces = {
    async accountOf() {
      return 'acc-1';
    },
    async getById() {
      return { id: ws, name: 'Shop Lan' };
    },
    async listMembers() {
      return [{ userId: assignee, role: 'sales', status: 'active', joinedAt: now }];
    },
  } as unknown as WorkspaceFacade;
  return { runner: new TaskReminderRunner(store, notifications, workspaces), sent, rows };
}

const row = (over: Partial<Row>): Row => ({
  id: '018d0000-0000-7000-8000-000000000100',
  workspaceId: ws,
  title: 'Gọi lại chị B',
  assigneeUserId: assignee,
  contactName: 'Chị B',
  dueAt: new Date('2026-11-11T02:59:00.000Z'),
  remindedAt: null,
  status: 'open',
  ...over,
});

describe('TaskReminderRunner.tick', () => {
  it('notifies the assignee of a due open task once, in-app and push, then marks it reminded', async () => {
    const t = setup([row({})]);
    expect(await t.runner.tick(now)).toBe(1);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      accountId: 'acc-1',
      userId: assignee,
      workspaceId: ws,
      type: 'task.due',
      params: { taskId: row({}).id },
      target: { kind: 'path', path: '/app/analytics' },
      channels: ['in_app', 'push'],
      dedupKey: `task:${row({}).id}:due:${row({}).dueAt.getTime()}`,
    });
    expect(t.sent[0]?.title).toContain('Gọi lại chị B');
    expect(t.sent[0]?.body).toContain('Chị B');
    expect(t.rows[0]?.remindedAt).toEqual(now);

    expect(await t.runner.tick(new Date(now.getTime() + 30_000))).toBe(0);
    expect(t.sent).toHaveLength(1);
  });

  it('leaves tasks not yet due, done ones, and marks those of a removed member without a notice', async () => {
    const t = setup([
      row({ id: 'a', dueAt: new Date(now.getTime() + 60_000) }),
      row({ id: 'b', status: 'done' }),
      row({ id: 'c', assigneeUserId: removed }),
    ]);
    expect(await t.runner.tick(now)).toBe(0);
    expect(t.sent).toHaveLength(0);
    expect(t.rows.map((r) => r.remindedAt)).toEqual([null, null, now]);
  });

  it('keeps a task for the next tick when the notice fails', async () => {
    const t = setup([row({})]);
    (t.runner as unknown as { notifications: NotificationFacade }).notifications.notify =
      async () => {
        throw new Error('down');
      };
    expect(await t.runner.tick(now)).toBe(0);
    expect(t.rows[0]?.remindedAt).toBeNull();
  });

  it('gives up on a task whose notice keeps failing, so it does not hold the queue', async () => {
    const t = setup([row({})]);
    (t.runner as unknown as { notifications: NotificationFacade }).notifications.notify =
      async () => {
        throw new Error('bad row');
      };
    for (let i = 1; i < MAX_REMINDER_FAILURES; i++) {
      await t.runner.tick(new Date(now.getTime() + i * 30_000));
    }
    expect(t.rows[0]?.remindedAt).toBeNull();
    await t.runner.tick(new Date(now.getTime() + MAX_REMINDER_FAILURES * 30_000));
    expect(t.rows[0]?.remindedAt).not.toBeNull();
  });

  it('does not mark a task reminded when its due time or assignee changed while notifying', async () => {
    const t = setup([row({})]);
    const moved = new Date('2026-11-11T05:00:00.000Z');
    const notify = (t.runner as unknown as { notifications: NotificationFacade }).notifications;
    const real = notify.notify.bind(notify);
    notify.notify = async (i) => {
      Object.assign(t.rows[0] ?? {}, { dueAt: moved });
      return real(i);
    };
    await t.runner.tick(now);
    expect(t.rows[0]?.remindedAt).toBeNull();
  });

  it('a new due time gets a notice of its own (the dedup key carries it)', async () => {
    const t = setup([row({})]);
    await t.runner.tick(now);
    const moved = new Date('2026-11-11T03:10:00.000Z');
    Object.assign(t.rows[0] ?? {}, { remindedAt: null, dueAt: moved });
    await t.runner.tick(new Date('2026-11-11T03:11:00.000Z'));
    expect(t.sent.map((x) => x.dedupKey)).toEqual([
      `task:${row({}).id}:due:${row({}).dueAt.getTime()}`,
      `task:${row({}).id}:due:${moved.getTime()}`,
    ]);
  });
});
