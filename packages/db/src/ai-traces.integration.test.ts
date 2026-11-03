import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import {
  aiRuns,
  aiRunSteps,
  aiRunTraces,
  assistantProposals,
  bots,
  users,
  workspaces,
} from './schema/index.js';
import { withSystem, withTenant } from './tenant.js';

/**
 * Shop-bot turn traces (0063): forced RLS on `ai_run_traces` / `ai_run_steps`, cascade from
 * `ai_runs`, the CHECKs, the accent-insensitive excerpt expression and `assistant_proposals.result_id`.
 */
let pg: TestPostgres;
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
const ws: WorkspaceId[] = [];
const botIds: string[] = [];

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  for (let i = 0; i < 2; i++) {
    const id = workspaceId(newId());
    const owner = userId(newId());
    const botId = newId();
    await withSystem(system.db, (tx) =>
      tx.insert(users).values({ id: owner, email: `${owner}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenant.db, id, async (tx) => {
      await tx.insert(workspaces).values({
        id,
        workspaceId: id,
        name: `Shop ${i}`,
        industry: 'retail',
        ownerUserId: owner,
      });
      await tx
        .insert(bots)
        .values({ id: botId, workspaceId: id, name: 'Bot', industry: 'retail', settings: {} });
    });
    ws.push(id);
    botIds.push(botId);
  }
});

afterAll(async () => {
  await tenant?.close();
  await system?.close();
  await pg?.stop();
});

async function seedTurn(i: number, over: { queryExcerpt?: string } = {}) {
  const w = ws[i] as WorkspaceId;
  const botId = botIds[i] as string;
  const runId = newId();
  await withTenant(tenant.db, w, async (tx) => {
    await tx.insert(aiRuns).values({
      id: runId,
      workspaceId: w,
      botId,
      tier: 'smart',
      provider: 'fake',
      model: 'fake-1',
      promptVersion: 'v1',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      latencyMs: 100,
      outcome: 'answered',
    });
    await tx.insert(aiRunTraces).values({
      runId,
      workspaceId: w,
      botId,
      startedAt: new Date(),
      systemPromptSha: 'a'.repeat(64),
      situationsSha: 'b'.repeat(64),
      loopOutcome: 'done',
      offeredTools: ['send_message'],
      queryExcerpt: over.queryExcerpt ?? null,
    });
    await tx.insert(aiRunSteps).values([
      { runId, idx: 0, workspaceId: w, kind: 'model_call', ms: 10 },
      { runId, idx: 1, workspaceId: w, kind: 'tool', toolName: 'search_products', ok: true },
    ]);
  });
  return runId;
}

describe('ai_run_traces / ai_run_steps on Postgres', () => {
  it('keeps traces and steps inside their workspace under app_tenant', async () => {
    const runId = await seedTurn(0);
    const own = await withTenant(tenant.db, ws[0] as WorkspaceId, (tx) =>
      tx.select().from(aiRunTraces).where(eq(aiRunTraces.runId, runId)),
    );
    expect(own).toHaveLength(1);
    const other = ws[1] as WorkspaceId;
    expect(
      await withTenant(tenant.db, other, (tx) =>
        tx.select().from(aiRunTraces).where(eq(aiRunTraces.runId, runId)),
      ),
    ).toEqual([]);
    expect(
      await withTenant(tenant.db, other, (tx) =>
        tx.select().from(aiRunSteps).where(eq(aiRunSteps.runId, runId)),
      ),
    ).toEqual([]);
    await expect(
      withTenant(tenant.db, other, (tx) =>
        tx.insert(aiRunSteps).values({ runId, idx: 9, workspaceId: ws[0] as string, kind: 'tool' }),
      ),
    ).rejects.toThrow();
  });

  it('cascades from ai_runs', async () => {
    const runId = await seedTurn(0);
    const w = ws[0] as WorkspaceId;
    await withTenant(tenant.db, w, (tx) => tx.delete(aiRuns).where(eq(aiRuns.id, runId)));
    const [counts] = await withSystem(system.db, (tx) =>
      tx.execute<{ traces: number; steps: number }>(
        sql`select (select count(*)::int from ai_run_traces where run_id = ${runId}) as traces,
                   (select count(*)::int from ai_run_steps where run_id = ${runId}) as steps`,
      ),
    );
    expect(counts).toEqual({ traces: 0, steps: 0 });
  });

  it('enforces the excerpt, loop outcome and list-size checks', async () => {
    const w = ws[0] as WorkspaceId;
    const runId = await seedTurn(0);
    await expect(
      withTenant(tenant.db, w, (tx) =>
        tx
          .update(aiRunTraces)
          .set({ queryExcerpt: 'x'.repeat(301) })
          .where(eq(aiRunTraces.runId, runId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenant.db, w, (tx) =>
        tx
          .update(aiRunTraces)
          .set({ loopOutcome: 'nope' as 'done' })
          .where(eq(aiRunTraces.runId, runId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenant.db, w, (tx) =>
        tx
          .update(aiRunTraces)
          .set({ focusProductIds: [newId(), newId(), newId(), newId()] })
          .where(eq(aiRunTraces.runId, runId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenant.db, w, (tx) =>
        tx
          .update(aiRunSteps)
          .set({ detail: { blob: 'x'.repeat(2_100) } })
          .where(eq(aiRunSteps.runId, runId)),
      ),
    ).rejects.toThrow();
  });

  it('matches excerpts without accents through assistant_unaccent', async () => {
    const runId = await seedTurn(1, { queryExcerpt: 'áo này giá bao nhiêu' });
    const rows = await withTenant(tenant.db, ws[1] as WorkspaceId, (tx) =>
      tx
        .select({ runId: aiRunTraces.runId })
        .from(aiRunTraces)
        .where(
          sql`assistant_unaccent(coalesce(${aiRunTraces.queryExcerpt}, '') || ' ' || coalesce(${aiRunTraces.replyExcerpt}, '')) ilike '%' || assistant_unaccent(${'gia'}) || '%'`,
        ),
    );
    expect(rows.map((r) => r.runId)).toEqual([runId]);
  });

  it('adds a nullable result_id to assistant_proposals', async () => {
    const [col] = await withSystem(system.db, (tx) =>
      tx.execute<{ is_nullable: string; data_type: string }>(
        sql`select is_nullable, data_type from information_schema.columns
            where table_name = 'assistant_proposals' and column_name = 'result_id'`,
      ),
    );
    expect(col).toEqual({ is_nullable: 'YES', data_type: 'uuid' });
    expect(assistantProposals.resultId.name).toBe('result_id');
  });
});
