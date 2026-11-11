import { z } from 'zod';

import { CursorQuery, paginated } from '../common/pagination.js';

/**
 * CRM tasks (CRM-04, spec 2026-11-11 §4): a to-do for a member, optionally linked to a customer,
 * a conversation or another record (`subjectType` + `subjectId`, opaque ids).
 */

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** Where a task was made: the task form, an item of the Today screen, or the owner assistant. */
export const TaskSource = z.enum(['manual', 'today', 'assistant']);
export type TaskSource = z.infer<typeof TaskSource>;

export const TASK_TITLE_MAX = 200;
export const TASK_NOTE_MAX = 2000;

export const TaskDto = z.object({
  id: z.uuid(),
  title: z.string(),
  note: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  /** null: unassigned (every member may pick it up). */
  assigneeUserId: z.uuid().nullable(),
  /** null when unassigned or when the assignee is no longer a member. */
  assigneeName: z.string().nullable(),
  status: TaskStatus,
  contactId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.uuid().nullable(),
  source: TaskSource,
  createdAt: z.iso.datetime(),
  /** When it was completed or cancelled. */
  doneAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type TaskDto = z.infer<typeof TaskDto>;
export const TaskList = paginated(TaskDto);
export type TaskList = z.infer<typeof TaskList>;

const title = z.string().trim().min(1).max(TASK_TITLE_MAX);
const note = z.string().trim().max(TASK_NOTE_MAX);

export const CreateTaskRequest = z
  .object({
    title,
    note: note.nullable().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    /** An active member of the business; omitted or null = unassigned. */
    assigneeUserId: z.uuid().nullable().optional(),
    contactId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
    /** The kind of record the task is about (`order`, `booking`…), with its id. */
    subjectType: z.string().trim().min(1).max(40).optional(),
    subjectId: z.uuid().optional(),
    source: TaskSource.default('manual'),
  })
  .refine((t) => (t.subjectType === undefined) === (t.subjectId === undefined), {
    message: 'give subjectType and subjectId together',
    path: ['subjectId'],
  });
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

/** Only sent fields change; null clears note, due time and assignee. */
export const UpdateTaskRequest = z.object({
  title: title.optional(),
  note: note.nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  assigneeUserId: z.uuid().nullable().optional(),
  /** The version the edit is based on; a newer stored version answers 409. */
  version: z.number().int().min(1),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

/**
 * `mine`: tasks assigned to me and unassigned ones. `all` needs `contacts.view_all`.
 * `overdue`: open with a due time in the past. No status: every status.
 */
export const TaskListQuery = CursorQuery.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['open', 'done', 'overdue']).optional(),
  contactId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuery>;
