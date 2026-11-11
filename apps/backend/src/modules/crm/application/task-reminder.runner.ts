import { notificationStrings } from '@agent-sales/i18n/notification';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { NOTIFICATION_FACADE, type NotificationFacade } from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { CrmTaskRunner } from '../api/crm-task.runner.js';
import {
  type DueTaskReminder,
  TASK_REMINDER_STORE,
  type TaskReminderStore,
} from './ports/task-reminder-store.js';

/** Tasks reminded per tick; the rest wait for the next one. */
const BATCH = 100;
/** Where a reminder opens: the Today screen lists the user's tasks. */
export const TASK_DUE_PATH = '/app/today';

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

interface WorkspaceInfo {
  accountId: string | null;
  name: string;
  members: Set<string>;
}

/**
 * Due-task reminders (spec 2026-11-11 §4): when `due_at` passes, the assignee gets one in-app and
 * push notice (`dedupKey task:<id>:due`), then the task is marked `reminded_at`. An assignee who
 * is no longer an active member is marked without a notice; a failed notice is retried next tick
 * (the dedup key keeps it to one notice). Logs carry ids and error classes only.
 */
@Injectable()
export class TaskReminderRunner implements CrmTaskRunner {
  readonly #log = new Logger('TaskReminderRunner');

  constructor(
    @Inject(TASK_REMINDER_STORE) private readonly store: TaskReminderStore,
    @Inject(NOTIFICATION_FACADE) private readonly notifications: NotificationFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async tick(now = new Date()): Promise<number> {
    const due = await this.store.due(now, BATCH);
    const infos = new Map<string, Promise<WorkspaceInfo>>();
    let sent = 0;
    for (const task of due) {
      try {
        let info = infos.get(task.workspaceId);
        if (!info) {
          info = this.#info(task.workspaceId as WorkspaceId);
          infos.set(task.workspaceId, info);
        }
        const ws = await info;
        const assignee = task.assigneeUserId;
        if (assignee && ws.accountId && ws.members.has(assignee)) {
          await this.#notify(task, assignee, ws.accountId, ws.name);
          sent++;
        }
        await this.store.markReminded(task.id, now);
      } catch (e) {
        this.#log.warn(
          `task ${task.id}: reminder not sent (${e instanceof Error ? e.name : 'unknown'})`,
        );
      }
    }
    return sent;
  }

  async #info(ws: WorkspaceId): Promise<WorkspaceInfo> {
    const [accountId, business, members] = await Promise.all([
      this.workspaces.accountOf(ws),
      this.workspaces.getById(ws),
      this.workspaces.listMembers(ws),
    ]);
    return {
      accountId,
      name: business.name,
      members: new Set(members.filter((m) => m.status === 'active').map((m) => String(m.userId))),
    };
  }

  async #notify(
    task: DueTaskReminder,
    userId: string,
    accountId: string,
    business: string,
  ): Promise<void> {
    const s = notificationStrings(await this.notifications.recipientLocale(userId as UserId));
    const vars = { title: task.title, business, customer: task.contactName ?? '' };
    const body = task.contactName ? s['task.due.body_customer'] : s['task.due.body'];
    await this.notifications.notify({
      accountId,
      userId,
      workspaceId: task.workspaceId,
      type: 'task.due',
      params: { taskId: task.id },
      title: fill(s['task.due.title'] ?? '', vars).slice(0, 160),
      body: fill(body ?? '', vars).slice(0, 4000),
      target: { kind: 'path', path: TASK_DUE_PATH },
      channels: ['in_app', 'push'],
      dedupKey: `task:${task.id}:due`,
    });
  }
}
