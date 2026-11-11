import { StaleVersionError, TaskClosedError } from './crm.errors.js';

/** Task rules (CRM-04, spec 2026-11-11 §4). Pure: no clock, no I/O. */

export type TaskStatus = 'open' | 'done' | 'cancelled';
export type TaskSource = 'manual' | 'today' | 'assistant';

/** One `tasks` row (the reminder bookkeeping column stays in the store). */
export interface Task {
  id: string;
  title: string;
  note: string | null;
  dueAt: Date | null;
  /** null: unassigned. May point to a removed member (no foreign key to users). */
  assigneeUserId: string | null;
  status: TaskStatus;
  /** When it was completed or cancelled, and by whom. */
  doneAt: Date | null;
  doneBy: string | null;
  contactId: string | null;
  conversationId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  source: TaskSource;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Who looks at tasks: `viewAll` is the role's `contacts.view_all`. */
export interface TaskViewer {
  userId: string;
  viewAll: boolean;
}

/**
 * Without `contacts.view_all` (Sales, CSKH) a member sees the tasks assigned to them and the
 * unassigned ones, like customers (crm-rules `canSee`).
 */
export function canSeeTask(t: Pick<Task, 'assigneeUserId'>, viewer: TaskViewer): boolean {
  return viewer.viewAll || t.assigneeUserId === null || t.assigneeUserId === viewer.userId;
}

export function isOverdue(t: Pick<Task, 'status' | 'dueAt'>, now: Date): boolean {
  return t.status === 'open' && t.dueAt !== null && t.dueAt.getTime() < now.getTime();
}

export interface TaskChange {
  task: Task;
  /** false: nothing to write (a retry, or an edit equal to what is stored). */
  changed: boolean;
}

function close(t: Task, to: 'done' | 'cancelled', actor: string, now: Date): TaskChange {
  if (t.status === to) return { task: t, changed: false };
  if (t.status !== 'open') throw new TaskClosedError(t.status);
  return {
    task: {
      ...t,
      status: to,
      doneAt: now,
      doneBy: actor,
      updatedAt: now,
      version: t.version + 1,
    },
    changed: true,
  };
}

/** Idempotent: a done task stays as it is. A cancelled one is a conflict. */
export function completeTask(t: Task, actor: string, now: Date): TaskChange {
  return close(t, 'done', actor, now);
}

/** Idempotent: a cancelled task stays as it is. A done one is a conflict. */
export function cancelTask(t: Task, actor: string, now: Date): TaskChange {
  return close(t, 'cancelled', actor, now);
}

export interface TaskPatch {
  title?: string | undefined;
  note?: string | null | undefined;
  dueAt?: Date | null | undefined;
  assigneeUserId?: string | null | undefined;
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

/** Applies the sent fields when `expectedVersion` is the stored one (else 409). */
export function editTask(
  t: Task,
  patch: TaskPatch,
  expectedVersion: number,
  now: Date,
): TaskChange {
  if (t.version !== expectedVersion) throw new StaleVersionError('task', t.version);
  const next: Task = { ...t };
  let changed = false;
  for (const key of ['title', 'note', 'dueAt', 'assigneeUserId'] as const) {
    const value = patch[key];
    if (value === undefined || sameValue(value, t[key])) continue;
    (next as Record<typeof key, unknown>)[key] = value;
    changed = true;
  }
  if (!changed) return { task: t, changed: false };
  return { task: { ...next, updatedAt: now, version: t.version + 1 }, changed: true };
}
