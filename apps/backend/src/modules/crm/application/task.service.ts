import {
  CreateTaskRequest,
  roleCan,
  type TaskDto,
  type TaskList,
  TaskListQuery,
  UpdateTaskRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  ContactNotFoundError,
  InvalidTaskCursorError,
  StaleVersionError,
  TaskAssigneeNotMemberError,
  TaskNotFoundError,
  TaskScopeNotAllowedError,
} from '../domain/crm.errors.js';
import {
  cancelTask,
  canSeeTask,
  completeTask,
  editTask,
  type Task,
  type TaskChange,
  type TaskViewer,
} from '../domain/task.js';
import { canSee, type Viewer } from './crm-rules.js';
import { toTaskDto } from './crm.mappers.js';
import { CRM_STORE, type CrmStore, type CrmTx } from './ports/crm-store.js';

const taskViewer = (v: Viewer): TaskViewer => ({
  userId: v.userId,
  viewAll: roleCan(v.role, 'contacts.view_all'),
});

/** The list cursor is the offset of the next page (tasks lists are short and ordered by due). */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d{1,9}$/.test(cursor)) throw new InvalidTaskCursorError();
  return Number(cursor);
}

/** Tasks of the team (CRM-04, spec 2026-11-11 §4). Visibility follows `contacts.view_all`. */
@Injectable()
export class TaskService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async list(ws: WorkspaceId, raw: unknown, viewer: Viewer): Promise<TaskList> {
    const q = TaskListQuery.parse(raw);
    const me = taskViewer(viewer);
    if (q.scope === 'all' && !me.viewAll) throw new TaskScopeNotAllowedError();
    const offset = offsetOf(q.cursor);
    const rows = await this.store.run(ws, (tx) =>
      tx.tasks.list(
        {
          assigneeScope: q.scope === 'mine' ? me.userId : null,
          status: q.status,
          contactId: q.contactId,
          conversationId: q.conversationId,
          now: new Date(),
        },
        { offset, limit: q.limit + 1 },
      ),
    );
    const page = rows.slice(0, q.limit);
    return {
      data: await this.#dtos(ws, page),
      page: { nextCursor: rows.length > q.limit ? String(offset + q.limit) : null },
    };
  }

  /** Any member may create a task; a linked customer must be one the member can see. */
  async create(ws: WorkspaceId, raw: unknown, viewer: Viewer): Promise<TaskDto> {
    const input = CreateTaskRequest.parse(raw);
    if (input.assigneeUserId) await this.#assertMember(ws, input.assigneeUserId);
    const task = await this.store.run(ws, async (tx) => {
      if (input.contactId) {
        const contact = await tx.contacts.find(input.contactId);
        if (!contact || !canSee(contact, viewer)) throw new ContactNotFoundError(input.contactId);
      }
      const now = new Date();
      const rec: Task = {
        id: newId(),
        title: input.title,
        note: input.note || null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assigneeUserId: input.assigneeUserId ?? null,
        status: 'open',
        doneAt: null,
        doneBy: null,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        source: input.source,
        createdBy: viewer.userId,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await tx.tasks.insert(ws, rec);
      return rec;
    });
    return this.#dto(ws, task);
  }

  async update(ws: WorkspaceId, id: string, raw: unknown, viewer: Viewer): Promise<TaskDto> {
    const { version, ...input } = UpdateTaskRequest.parse(raw);
    if (input.assigneeUserId) await this.#assertMember(ws, input.assigneeUserId);
    return this.#change(ws, id, viewer, (t, now) =>
      editTask(
        t,
        {
          title: input.title,
          note: input.note === undefined ? undefined : input.note || null,
          dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
          assigneeUserId: input.assigneeUserId,
        },
        version,
        now,
      ),
    );
  }

  /** Idempotent: a done task answers as it is. */
  complete(ws: WorkspaceId, id: string, viewer: Viewer): Promise<TaskDto> {
    return this.#change(ws, id, viewer, (t, now) => completeTask(t, viewer.userId, now));
  }

  /** Idempotent: a cancelled task answers as it is. */
  cancel(ws: WorkspaceId, id: string, viewer: Viewer): Promise<TaskDto> {
    return this.#change(ws, id, viewer, (t, now) => cancelTask(t, viewer.userId, now));
  }

  /** Open tasks due before `dueBefore`: of `userId` and unassigned ones, or all without it. */
  countOpen(ws: WorkspaceId, q: { userId?: string; dueBefore: Date }): Promise<number> {
    return this.store.run(ws, (tx) => tx.tasks.countOpenDueBefore(q.userId ?? null, q.dueBefore));
  }

  /** Open tasks by due time: of `userId` and unassigned ones, or all without it. */
  async listOpen(ws: WorkspaceId, q: { userId?: string; limit: number }): Promise<TaskDto[]> {
    const rows = await this.store.run(ws, (tx) =>
      tx.tasks.list(
        { assigneeScope: q.userId ?? null, status: 'open', now: new Date() },
        { offset: 0, limit: q.limit },
      ),
    );
    return this.#dtos(ws, rows);
  }

  async #change(
    ws: WorkspaceId,
    id: string,
    viewer: Viewer,
    apply: (t: Task, now: Date) => TaskChange,
  ): Promise<TaskDto> {
    const task = await this.store.run(ws, async (tx) => {
      const current = await this.#visible(tx, id, viewer);
      const { task: next, changed } = apply(current, new Date());
      if (changed && !(await tx.tasks.update(next, current.version)))
        throw new StaleVersionError('task', current.version);
      return next;
    });
    return this.#dto(ws, task);
  }

  async #visible(tx: CrmTx, id: string, viewer: Viewer): Promise<Task> {
    const t = isUuid(id) ? await tx.tasks.find(id, { forUpdate: true }) : null;
    if (!t || !canSeeTask(t, taskViewer(viewer))) throw new TaskNotFoundError(id);
    return t;
  }

  async #assertMember(ws: WorkspaceId, id: string): Promise<void> {
    const members = await this.workspaces.listMembers(ws);
    if (!members.some((m) => String(m.userId) === id)) throw new TaskAssigneeNotMemberError(id);
  }

  async #dto(ws: WorkspaceId, t: Task): Promise<TaskDto> {
    const [dto] = await this.#dtos(ws, [t]);
    if (!dto) throw new TaskNotFoundError(t.id);
    return dto;
  }

  /** Assignee names of active members; a removed member's id gives no name. */
  async #dtos(ws: WorkspaceId, tasks: readonly Task[]): Promise<TaskDto[]> {
    const wanted = new Set(tasks.flatMap((t) => (t.assigneeUserId ? [t.assigneeUserId] : [])));
    const names = new Map<string, string | null>();
    if (wanted.size) {
      const active = (await this.workspaces.listMembers(ws)).filter(
        (m) => m.status === 'active' && wanted.has(String(m.userId)),
      );
      await Promise.all(
        active.map(async (m) =>
          names.set(String(m.userId), await this.identity.displayName(userId(String(m.userId)))),
        ),
      );
    }
    return tasks.map((t) =>
      toTaskDto(t, t.assigneeUserId ? (names.get(t.assigneeUserId) ?? null) : null),
    );
  }
}
