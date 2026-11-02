import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  sql,
  withCredentials,
  withSystem,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AiRunRecord } from '../domain/ports/ai-run.repository.js';
import type { TurnTraceRecord } from '../domain/ports/turn-trace.repository.js';
import { DrizzleAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import { DrizzleTurnTraceRepository } from '../infrastructure/persistence/turn-trace.repositories.js';
import { runRecord, traceRecord } from './factories/turn-trace.factory.js';

/** DrizzleTurnTraceRepository on Postgres: isolation, keyset, `around`, `q` and the purge. */
const DAY = 86_400_000;
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let system: Database;
let runs: DrizzleAiRunRepository;
let repo: DrizzleTurnTraceRepository;
const ws: WorkspaceId[] = [];
const bots: string[] = [];

function open(url: string): Database {
  const h = createDb({ url, max: 1 });
  handles.push(h);
  return h.db;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenant = open(withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password));
  system = open(withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password));
  runs = new DrizzleAiRunRepository(tenant);
  repo = new DrizzleTurnTraceRepository(tenant, system);
  for (let i = 0; i < 2; i++) {
    const id = workspaceId(newId());
    const owner = userId(newId());
    const botId = newId();
    await withSystem(system, async (tx) => {
      await tx.insert(schema.users).values({ id: owner, email: `${owner}@x.test`, name: 'O' });
      await tx.insert(schema.workspaces).values({
        id,
        workspaceId: id,
        name: `Shop ${i}`,
        industry: 'retail',
        ownerUserId: owner,
      });
      await tx
        .insert(schema.bots)
        .values({ id: botId, workspaceId: id, name: 'Bot', industry: 'retail', settings: {} });
    });
    ws.push(id);
    bots.push(botId);
  }
});

afterAll(async () => {
  await Promise.all(handles.map((h) => h.close()));
  await pg?.stop();
});

const A = () => ws[0] as WorkspaceId;
const B = () => ws[1] as WorkspaceId;

async function turn(
  w: WorkspaceId,
  run: Partial<AiRunRecord>,
  trace: Partial<TurnTraceRecord> | null = {},
): Promise<AiRunRecord> {
  const r = runRecord({ botId: bots[ws.indexOf(w)] ?? newId(), ...run });
  await runs.record(w, r);
  if (trace) {
    await repo.record(w, traceRecord(r, trace), [
      {
        idx: 0,
        kind: 'model_call',
        toolName: null,
        ok: null,
        errorCode: null,
        ms: 5,
        detail: null,
      },
      {
        idx: 1,
        kind: 'tool',
        toolName: 'search_products',
        ok: true,
        errorCode: null,
        ms: 3,
        detail: { resultCount: 0 },
      },
      {
        idx: 2,
        kind: 'tool',
        toolName: 'calculate',
        ok: true,
        errorCode: null,
        ms: 1,
        detail: null,
      },
    ]);
  }
  return r;
}

const filter = (botId: string, over: Record<string, unknown> = {}) => ({
  botId,
  from: new Date(Date.now() - 30 * DAY),
  to: new Date(Date.now() + DAY),
  includeTests: false,
  limit: 10,
  ...over,
});

describe('DrizzleTurnTraceRepository', () => {
  it('reads its own workspace only, joins traces and returns steps in order', async () => {
    const r = await turn(A(), {});
    const bare = await turn(A(), {}, null);
    const rows = await repo.list(A(), filter(bots[0] as string));
    const byId = new Map(rows.map((x) => [x.run.id, x]));
    expect(byId.get(r.id)?.trace?.offeredTools).toEqual(['send_message']);
    expect(byId.get(bare.id)?.trace).toBeNull();
    expect(await repo.get(B(), r.botId, r.id)).toBeNull();
    expect(await repo.get(A(), bots[1] as string, r.id)).toBeNull();
    const got = await repo.get(A(), r.botId, r.id);
    expect(got?.steps.map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(got?.run.retrieved).toEqual([]);
    const signal = await repo.signalSteps(A(), [r.id]);
    expect(signal.get(r.id)?.map((s) => s.toolName)).toEqual(['search_products']);
    expect(await repo.signalSteps(B(), [r.id])).toEqual(new Map());
  });

  it('matches q accent-insensitively and treats wildcards literally', async () => {
    const botId = bots[1] as string;
    const hit = await turn(B(), {}, { queryExcerpt: 'áo này giá bao nhiêu', replyExcerpt: 'Dạ' });
    await turn(B(), {}, { queryExcerpt: 'còn hàng không' });
    expect((await repo.list(B(), filter(botId, { q: 'gia' }))).map((x) => x.run.id)).toEqual([
      hit.id,
    ]);
    expect(await repo.list(B(), filter(botId, { q: '%' }))).toEqual([]);
  });

  it('picks the turn around a moment, nearest first, and pages with a cursor', async () => {
    const conversationId = newId();
    const t0 = Date.now() - DAY;
    const first = await turn(A(), { conversationId, createdAt: new Date(t0) });
    const second = await turn(A(), { conversationId, createdAt: new Date(t0 + 30_000) });
    const around = await repo.list(
      A(),
      filter(bots[0] as string, { conversationId, around: new Date(t0 + 29_000) }),
    );
    expect(around.map((x) => x.run.id)).toEqual([second.id, first.id]);
    const early = await repo.list(
      A(),
      filter(bots[0] as string, { conversationId, around: new Date(t0 - 1_000) }),
    );
    expect(early.map((x) => x.run.id)).toEqual([first.id]);
    const page1 = await repo.list(A(), filter(bots[0] as string, { conversationId, limit: 1 }));
    expect(page1.map((x) => x.run.id)).toEqual([second.id]);
    const page2 = await repo.list(
      A(),
      filter(bots[0] as string, {
        conversationId,
        limit: 1,
        cursor: { createdAt: second.createdAt, runId: second.id },
      }),
    );
    expect(page2.map((x) => x.run.id)).toEqual([first.id]);
  });

  it('purges traces and steps older than the cut-off', async () => {
    const old = await turn(A(), {});
    const kept = await turn(A(), {});
    await withSystem(system, async (tx) => {
      for (const [id, days] of [
        [old.id, 31],
        [kept.id, 29],
      ] as const) {
        const at = new Date(Date.now() - days * DAY).toISOString();
        await tx.execute(
          sql`update ai_run_traces set created_at = ${at}::timestamptz where run_id = ${id}`,
        );
        await tx.execute(
          sql`update ai_run_steps set created_at = ${at}::timestamptz where run_id = ${id}`,
        );
      }
    });
    const before = new Date(Date.now() - 30 * DAY);
    expect(await repo.purgeExpired(before, 2)).toBe(3);
    expect(await repo.purgeExpired(before, 2)).toBe(1);
    expect(await repo.purgeExpired(before, 2)).toBe(0);
    expect((await repo.get(A(), old.botId, old.id))?.trace).toBeNull();
    expect((await repo.get(A(), kept.botId, kept.id))?.steps).toHaveLength(3);
  });
});
