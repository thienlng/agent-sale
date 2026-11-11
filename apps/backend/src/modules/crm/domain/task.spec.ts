import { describe, expect, it } from 'vitest';

import { StaleVersionError, TaskClosedError } from './crm.errors.js';
import { cancelTask, canSeeTask, completeTask, editTask, isOverdue, type Task } from './task.js';

const me = '018d0000-0000-7000-8000-00000000000a';
const other = '018d0000-0000-7000-8000-00000000000b';
const t0 = new Date('2026-11-11T01:00:00.000Z');
const later = new Date('2026-11-11T02:00:00.000Z');

function task(over: Partial<Task> = {}): Task {
  return {
    id: '018d0000-0000-7000-8000-000000000100',
    title: 'Gọi lại chị B',
    note: null,
    dueAt: null,
    assigneeUserId: me,
    status: 'open',
    doneAt: null,
    doneBy: null,
    contactId: null,
    conversationId: null,
    subjectType: null,
    subjectId: null,
    source: 'manual',
    createdBy: me,
    createdAt: t0,
    updatedAt: t0,
    version: 1,
    ...over,
  };
}

describe('completeTask', () => {
  it('marks an open task done with who and when, one version up', () => {
    const { task: done, changed } = completeTask(task(), other, later);
    expect(changed).toBe(true);
    expect(done).toMatchObject({ status: 'done', doneAt: later, doneBy: other, version: 2 });
  });

  it('is idempotent: completing twice changes nothing the second time', () => {
    const first = completeTask(task(), me, t0).task;
    const second = completeTask(first, other, later);
    expect(second.changed).toBe(false);
    expect(second.task).toBe(first);
  });

  it('refuses a cancelled task', () => {
    const cancelled = cancelTask(task(), me, t0).task;
    expect(() => completeTask(cancelled, me, later)).toThrow(TaskClosedError);
  });
});

describe('cancelTask', () => {
  it('is idempotent and refuses a done task', () => {
    const cancelled = cancelTask(task(), me, t0);
    expect(cancelled.task).toMatchObject({ status: 'cancelled', doneAt: t0, doneBy: me });
    expect(cancelTask(cancelled.task, me, later).changed).toBe(false);
    expect(() => cancelTask(completeTask(task(), me, t0).task, me, later)).toThrow(TaskClosedError);
  });
});

describe('editTask', () => {
  it('changes only the sent fields and bumps the version', () => {
    const due = new Date('2026-11-12T03:00:00.000Z');
    const { task: edited, changed } = editTask(
      task({ note: 'old' }),
      { title: 'Gửi báo giá', dueAt: due, assigneeUserId: null },
      1,
      later,
    );
    expect(changed).toBe(true);
    expect(edited).toMatchObject({
      title: 'Gửi báo giá',
      note: 'old',
      dueAt: due,
      assigneeUserId: null,
      version: 2,
      updatedAt: later,
    });
  });

  it('answers a conflict when the version moved on', () => {
    expect(() => editTask(task({ version: 3 }), { title: 'x' }, 2, later)).toThrow(
      StaleVersionError,
    );
  });

  it('writes nothing when nothing differs', () => {
    const same = task({ title: 'Gọi lại chị B' });
    const result = editTask(same, { title: 'Gọi lại chị B' }, 1, later);
    expect(result.changed).toBe(false);
    expect(result.task).toBe(same);
  });
});

describe('canSeeTask', () => {
  const viewer = { userId: me, viewAll: false };

  it('without view_all: my tasks and unassigned ones only', () => {
    expect(canSeeTask(task({ assigneeUserId: me }), viewer)).toBe(true);
    expect(canSeeTask(task({ assigneeUserId: null }), viewer)).toBe(true);
    expect(canSeeTask(task({ assigneeUserId: other, createdBy: me }), viewer)).toBe(false);
  });

  it('with view_all: every task', () => {
    expect(canSeeTask(task({ assigneeUserId: other }), { userId: me, viewAll: true })).toBe(true);
  });
});

describe('isOverdue', () => {
  it('an open task whose due time has passed', () => {
    expect(isOverdue(task({ dueAt: t0 }), later)).toBe(true);
    expect(isOverdue(task({ dueAt: later }), t0)).toBe(false);
    expect(isOverdue(task({ dueAt: null }), later)).toBe(false);
    expect(isOverdue(task({ dueAt: t0, status: 'done' }), later)).toBe(false);
  });
});
