import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { AiRunRecord } from '../domain/ports/ai-run.repository.js';
import type { TurnStepRecord, TurnTraceRecord } from '../domain/ports/turn-trace.repository.js';
import { runRecord, traceRecord } from './factories/turn-trace.factory.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';
import {
  escapeLike,
  InMemoryTurnTraceRepository,
} from '../infrastructure/persistence/turn-trace.repositories.js';

const DAY = 86_400_000;

const step = (over: Partial<TurnStepRecord>): TurnStepRecord => ({
  idx: 0,
  kind: 'tool',
  toolName: null,
  ok: true,
  errorCode: null,
  ms: 1,
  detail: null,
  ...over,
});

function setup(now = () => new Date()) {
  const runs = new InMemoryAiRunRepository();
  const repo = new InMemoryTurnTraceRepository(runs, now);
  const add = async (ws: WorkspaceId, run: AiRunRecord, trace?: Partial<TurnTraceRecord>) => {
    await runs.record(ws, run);
    if (trace)
      await repo.record(ws, traceRecord(run, trace), [step({ idx: 0, kind: 'model_call' })]);
    return run;
  };
  return { runs, repo, add };
}

const window = (botId: string) => ({
  botId,
  from: new Date(Date.now() - 30 * DAY),
  to: new Date(Date.now() + DAY),
  includeTests: false,
  limit: 10,
});

describe('InMemoryTurnTraceRepository', () => {
  it('keeps workspaces apart and lists runs without a trace', async () => {
    const { repo, add } = setup();
    const a = workspaceId(newId());
    const b = workspaceId(newId());
    const run = await add(a, runRecord(), {});
    const old = await add(a, runRecord({ botId: run.botId }));
    const listed = await repo.list(a, window(run.botId));
    expect(listed.map((r) => [r.run.id, r.trace !== null])).toEqual(
      expect.arrayContaining([
        [run.id, true],
        [old.id, false],
      ]),
    );
    expect(await repo.list(b, window(run.botId))).toEqual([]);
    expect(await repo.get(b, run.botId, run.id)).toBeNull();
    expect(await repo.get(a, newId(), run.id)).toBeNull();
    expect((await repo.get(a, run.botId, run.id))?.steps).toHaveLength(1);
  });

  it('drops the trace when its run is gone (cascade)', async () => {
    const { runs, repo, add } = setup();
    const ws = workspaceId(newId());
    const run = await add(ws, runRecord(), {});
    runs.runs.splice(0, 1);
    expect(await repo.get(ws, run.botId, run.id)).toBeNull();
    expect(await repo.signalSteps(ws, [run.id])).toEqual(new Map());
  });

  it('purges traces older than the cut-off only', async () => {
    let clock = Date.now() - 31 * DAY;
    const { repo, add } = setup(() => new Date(clock));
    const ws = workspaceId(newId());
    const oldRun = await add(ws, runRecord(), {});
    clock = Date.now() - 29 * DAY;
    const keptRun = await add(ws, runRecord(), {});
    const deleted = await repo.purgeExpired(new Date(Date.now() - 30 * DAY), 5_000);
    expect(deleted).toBe(2);
    expect(await repo.get(ws, oldRun.botId, oldRun.id)).toMatchObject({ trace: null });
    expect((await repo.get(ws, keptRun.botId, keptRun.id))?.trace).not.toBeNull();
  });

  it('matches q without accents', async () => {
    const { repo, add } = setup();
    const ws = workspaceId(newId());
    const botId = newId();
    const hit = await add(ws, runRecord({ botId }), { queryExcerpt: 'áo này giá bao nhiêu' });
    await add(ws, runRecord({ botId }), { queryExcerpt: 'còn hàng không' });
    const rows = await repo.list(ws, { ...window(botId), q: 'GIA' });
    expect(rows.map((r) => r.run.id)).toEqual([hit.id]);
  });

  it('picks the run whose window contains `around`, nearest first', async () => {
    const { repo, add } = setup();
    const ws = workspaceId(newId());
    const botId = newId();
    const conversationId = newId();
    const t0 = Date.now() - DAY;
    const first = await add(ws, runRecord({ botId, conversationId, createdAt: new Date(t0) }), {});
    const second = await add(
      ws,
      runRecord({ botId, conversationId, createdAt: new Date(t0 + 30_000) }),
      {},
    );
    const atSecond = await repo.list(ws, {
      ...window(botId),
      conversationId,
      around: new Date(t0 + 29_000),
    });
    expect(atSecond.map((r) => r.run.id)).toEqual([second.id, first.id]);
    const atFirst = await repo.list(ws, {
      ...window(botId),
      conversationId,
      around: new Date(t0 - 1_000),
    });
    expect(atFirst.map((r) => r.run.id)).toEqual([first.id]);
  });

  it('pages with a keyset cursor and hides tests unless asked', async () => {
    const { repo, add } = setup();
    const ws = workspaceId(newId());
    const botId = newId();
    const t0 = Date.now() - DAY;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await add(ws, runRecord({ botId, createdAt: new Date(t0 + i * 1000) }))).id);
    }
    await add(ws, runRecord({ botId, isTest: true, createdAt: new Date(t0 + 5000) }));
    const page1 = await repo.list(ws, { ...window(botId), limit: 2 });
    expect(page1.map((r) => r.run.id)).toEqual([ids[2], ids[1]]);
    const last = page1[1]!.run;
    const page2 = await repo.list(ws, {
      ...window(botId),
      limit: 2,
      cursor: { createdAt: last.createdAt, runId: last.id },
    });
    expect(page2.map((r) => r.run.id)).toEqual([ids[0]]);
    expect(await repo.list(ws, { ...window(botId), includeTests: true })).toHaveLength(4);
  });

  it('returns only signal steps', async () => {
    const { runs, repo } = setup();
    const ws = workspaceId(newId());
    const run = runRecord();
    await runs.record(ws, run);
    await repo.record(ws, traceRecord(run), [
      step({ idx: 0, kind: 'model_call', toolName: null }),
      step({ idx: 1, toolName: 'search_products', detail: { resultCount: 0 } }),
      step({ idx: 2, toolName: 'calculate', ok: false, errorCode: 'invalid_expression' }),
      step({ idx: 3, toolName: 'calculate' }),
      step({ idx: 4, toolName: 'action_1' }),
    ]);
    const map = await repo.signalSteps(ws, [run.id]);
    expect(map.get(run.id)?.map((s) => s.idx)).toEqual([1, 2, 4]);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
