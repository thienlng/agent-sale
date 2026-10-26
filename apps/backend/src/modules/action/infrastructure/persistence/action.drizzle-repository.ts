import { ActionAuth, ActionParam, ActionResponse } from '@agent-sales/contracts';
import { and, asc, eq, schema, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';

import type {
  ActionRecord,
  ActionRepository,
  ActionRunRecord,
  PendingRecord,
} from '../../application/ports/action-unit-of-work.js';

const t = schema.botActions;
type Row = typeof t.$inferSelect;

function toRecord(r: Row): ActionRecord {
  const auth = ActionAuth.parse(
    r.authKind === 'api_key'
      ? { kind: 'api_key', headerName: r.authHeaderName }
      : { kind: r.authKind },
  );
  return {
    id: r.id,
    botId: r.botId,
    name: r.name,
    description: r.description,
    url: r.url,
    method: r.method as ActionRecord['method'],
    params: z.array(ActionParam).parse(r.params),
    responses: z.array(ActionResponse).parse(r.responses),
    auth,
    authSecretEnc: r.authSecretEnc,
    requiresConfirm: r.requiresConfirm,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Bound to one withTenant transaction; every statement is also scoped by workspace_id. */
export class DrizzleActionRepository implements ActionRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly ws: WorkspaceId,
  ) {}

  async list(botId: string): Promise<ActionRecord[]> {
    const rows = await this.tx
      .select()
      .from(t)
      .where(and(eq(t.workspaceId, this.ws), eq(t.botId, botId)))
      .orderBy(asc(t.createdAt), asc(t.id))
      .limit(200);
    return rows.map(toRecord);
  }

  async find(botId: string, id: string): Promise<ActionRecord | null> {
    const [row] = await this.tx
      .select()
      .from(t)
      .where(and(eq(t.workspaceId, this.ws), eq(t.botId, botId), eq(t.id, id)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async save(r: ActionRecord): Promise<void> {
    const values = {
      name: r.name,
      description: r.description,
      url: r.url,
      method: r.method,
      params: r.params,
      responses: r.responses,
      authKind: r.auth.kind,
      authHeaderName: r.auth.kind === 'api_key' ? r.auth.headerName : null,
      authSecretEnc: r.authSecretEnc,
      requiresConfirm: r.requiresConfirm,
      enabled: r.enabled,
      updatedAt: new Date(r.updatedAt),
    };
    await this.tx
      .insert(t)
      .values({
        ...values,
        id: r.id,
        workspaceId: this.ws,
        botId: r.botId,
        createdAt: new Date(r.createdAt),
      })
      .onConflictDoUpdate({ target: t.id, set: values });
  }

  async delete(botId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(t)
      .where(and(eq(t.workspaceId, this.ws), eq(t.botId, botId), eq(t.id, id)))
      .returning({ id: t.id });
    return rows.length === 1;
  }

  async exists(id: string): Promise<boolean> {
    const rows = await this.tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.workspaceId, this.ws), eq(t.id, id)))
      .limit(1);
    return rows.length === 1;
  }

  async recordRun(run: ActionRunRecord): Promise<void> {
    await this.tx.insert(schema.actionRuns).values({ ...run, workspaceId: this.ws });
  }

  async findPending(conversationId: string, now: Date): Promise<PendingRecord | null> {
    const p = schema.actionPending;
    const [row] = await this.tx
      .select()
      .from(p)
      .where(and(eq(p.workspaceId, this.ws), eq(p.conversationId, conversationId)))
      .limit(1);
    if (!row || row.expiresAt <= now) return null;
    const args = z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .parse(row.args);
    return { actionId: row.actionId, args, expiresAt: row.expiresAt };
  }

  async savePending(conversationId: string, pending: PendingRecord): Promise<void> {
    const values = {
      actionId: pending.actionId,
      args: pending.args,
      expiresAt: pending.expiresAt,
    };
    await this.tx
      .insert(schema.actionPending)
      .values({ ...values, conversationId, workspaceId: this.ws })
      .onConflictDoUpdate({ target: schema.actionPending.conversationId, set: values });
  }

  async clearPending(conversationId: string): Promise<void> {
    const p = schema.actionPending;
    await this.tx
      .delete(p)
      .where(and(eq(p.workspaceId, this.ws), eq(p.conversationId, conversationId)));
  }

  async consumePending(conversationId: string, now: Date): Promise<PendingRecord | null> {
    const p = schema.actionPending;
    // DELETE ... RETURNING: concurrent consumers cannot both receive the row.
    const [row] = await this.tx
      .delete(p)
      .where(and(eq(p.workspaceId, this.ws), eq(p.conversationId, conversationId)))
      .returning();
    if (!row || row.expiresAt <= now) return null;
    const args = z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .parse(row.args);
    return { actionId: row.actionId, args, expiresAt: row.expiresAt };
  }
}
