import { AuditQuery, type AuditList } from '@agent-sales/contracts';
import { startOfLocalDay, nextDate, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AuditFacade } from '../api/audit.facade.js';
import { AUDIT_STORE, type AuditStore } from './ports/audit-store.js';

/** Reads the audit trail: newest first, keyset pages, day filters in the workspace time zone. */
@Injectable()
export class AuditService implements AuditFacade {
  constructor(
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async list(ws: WorkspaceId, raw: AuditQuery): Promise<AuditList> {
    const q = AuditQuery.parse(raw);
    const tz = (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
    // One more than asked: its presence tells whether there is a next page.
    const rows = await this.store.list(ws, {
      action: q.action,
      from: q.from ? startOfLocalDay(q.from, tz) : undefined,
      to: q.to ? startOfLocalDay(nextDate(q.to), tz) : undefined,
      before: q.before && q.beforeId ? { at: new Date(q.before), id: q.beforeId } : undefined,
      limit: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      data: page.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        actorName: r.actorName,
        data: r.data,
        at: r.createdAt.toISOString(),
      })),
      next:
        rows.length > q.limit && last
          ? { before: last.createdAt.toISOString(), beforeId: last.id }
          : null,
    };
  }
}
