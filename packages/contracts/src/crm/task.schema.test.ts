import { describe, expect, it } from 'vitest';

import { crmRoutes } from './crm.routes.js';
import {
  CreateTaskRequest,
  TaskDto,
  TaskList,
  TaskListQuery,
  UpdateTaskRequest,
} from './task.schema.js';

const task = {
  id: '7f8f6d1e-0d1a-4a8c-9a59-0c7bd4b6a001',
  title: 'Gọi lại chị B',
  note: null,
  dueAt: '2026-11-12T02:00:00.000Z',
  assigneeUserId: null,
  assigneeName: null,
  status: 'open',
  contactId: null,
  conversationId: null,
  subjectType: null,
  subjectId: null,
  source: 'manual',
  createdAt: '2026-11-11T00:00:00.000Z',
  doneAt: null,
  version: 1,
};

describe('task contracts', () => {
  it('parses a task and a page of tasks', () => {
    expect(TaskDto.parse(task)).toEqual(task);
    expect(TaskList.parse({ data: [task], page: { nextCursor: null } }).data).toHaveLength(1);
  });

  it('checks the title and note lengths, and defaults the source to manual', () => {
    expect(CreateTaskRequest.parse({ title: '  Gọi lại  ' })).toMatchObject({
      title: 'Gọi lại',
      source: 'manual',
    });
    expect(CreateTaskRequest.safeParse({ title: '   ' }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ title: 'x', note: 'n'.repeat(2001) }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ title: 'x', source: 'bot' }).success).toBe(false);
  });

  it('needs subjectType and subjectId together', () => {
    const subjectId = '7f8f6d1e-0d1a-4a8c-9a59-0c7bd4b6a002';
    expect(CreateTaskRequest.safeParse({ title: 'x', subjectId }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ title: 'x', subjectType: 'order' }).success).toBe(false);
    expect(
      CreateTaskRequest.safeParse({ title: 'x', subjectType: 'order', subjectId }).success,
    ).toBe(true);
  });

  it('needs the version on an update; null clears the optional fields', () => {
    expect(UpdateTaskRequest.safeParse({ title: 'x' }).success).toBe(false);
    expect(
      UpdateTaskRequest.parse({ version: 2, dueAt: null, assigneeUserId: null, note: null }),
    ).toEqual({ version: 2, dueAt: null, assigneeUserId: null, note: null });
  });

  it('lists my tasks by default, 50 at a time', () => {
    expect(TaskListQuery.parse({})).toEqual({ scope: 'mine', limit: 50 });
    expect(TaskListQuery.parse({ scope: 'all', status: 'overdue', limit: '10' })).toMatchObject({
      scope: 'all',
      status: 'overdue',
      limit: 10,
    });
    expect(TaskListQuery.safeParse({ status: 'cancelled' }).success).toBe(false);
  });

  it('declares every task route for the owner assistant', () => {
    const tasks = crmRoutes.filter((r) => r.path.startsWith('/tasks'));
    expect(tasks.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'get /tasks',
      'patch /tasks/{taskId}',
      'post /tasks',
      'post /tasks/{taskId}/cancel',
      'post /tasks/{taskId}/complete',
    ]);
    for (const r of tasks) expect(r.assistant?.use).toBe(r.method === 'get' ? 'read' : 'write');
  });
});
