import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceLifecycle } from '../api/workspace-lifecycle.js';
import type {
  BusinessObjectEraser,
  DuePurge,
  WorkspacePurgeStore,
} from '../application/ports/workspace-purge.js';
import {
  PURGE_ALERT_AFTER,
  PURGE_BACKOFF_MAX_MS,
  PURGE_SCAN_MS,
  purgeBackoffMs,
  purgeErrorCode,
  WorkspacePurgeRunnerImpl,
} from '../application/workspace-purge.runner.js';

function fakes(due: WorkspaceId[] | DuePurge[], opts: { storage?: boolean } = {}) {
  const rows: DuePurge[] = due.map((d) =>
    typeof d === 'string' ? { workspaceId: d, attempts: 0 } : d,
  );
  const store = {
    due: vi.fn(async (_now: Date, _limit: number) => rows),
    claim: vi.fn(async (_ws: WorkspaceId) => true),
    purgeRows: vi.fn(async (_ws: WorkspaceId) => ({ contacts: 3, orders: 2 })),
    finish: vi.fn(async (_ws: WorkspaceId, _rows: number) => true),
    recordFailure: vi.fn(async (_ws: WorkspaceId, _f: { error: string; nextAt: Date }) => {}),
  } satisfies WorkspacePurgeStore;
  const objects = {
    available: vi.fn(() => opts.storage ?? true),
    erase: vi.fn(async (_ws: WorkspaceId) => 4),
  } satisfies BusinessObjectEraser;
  const lifecycle = new WorkspaceLifecycle();
  const hook = vi.fn(async (_ws: WorkspaceId) => {});
  lifecycle.onDeletionRequested('channel', hook);
  const runner = new WorkspacePurgeRunnerImpl(store, objects, lifecycle);
  return { store, objects, hook, runner };
}

const t0 = new Date('2026-12-12T03:00:00Z');
const MIN = 60_000;

describe('WorkspacePurgeRunnerImpl', () => {
  it('claims, re-runs the deletion hooks, then purges rows, files and the tombstone', async () => {
    const [a, b] = [workspaceId(newId()), workspaceId(newId())];
    const f = fakes([a, b]);
    expect(await f.runner.tick(t0)).toBe(2);
    expect(f.store.claim).toHaveBeenCalledWith(a);
    expect(f.hook).toHaveBeenCalledWith(a);
    expect(f.store.purgeRows).toHaveBeenCalledWith(a);
    expect(f.objects.erase).toHaveBeenCalledWith(b);
    expect(f.store.finish).toHaveBeenCalledWith(a, 5);
    const order = [
      f.store.claim.mock.invocationCallOrder[0],
      f.hook.mock.invocationCallOrder[0],
      f.store.purgeRows.mock.invocationCallOrder[0],
      f.objects.erase.mock.invocationCallOrder[0],
      f.store.finish.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((x = 0, y = 0) => x - y));
    expect(f.store.recordFailure).not.toHaveBeenCalled();
  });

  it('scans at most once per interval', async () => {
    const f = fakes([workspaceId(newId())]);
    await f.runner.tick(t0);
    expect(await f.runner.tick(new Date(t0.getTime() + PURGE_SCAN_MS - 1))).toBe(0);
    expect(f.store.due).toHaveBeenCalledTimes(1);
    await f.runner.tick(new Date(t0.getTime() + PURGE_SCAN_MS));
    expect(f.store.due).toHaveBeenCalledTimes(2);
  });

  it('skips a business a restore took back, and keeps going after a failure', async () => {
    const [restored, failing, ok] = [
      workspaceId(newId()),
      workspaceId(newId()),
      workspaceId(newId()),
    ];
    const f = fakes([restored, failing, ok]);
    f.store.claim.mockImplementation(async (ws) => ws !== restored);
    f.objects.erase.mockImplementation(async (ws) => {
      if (ws === failing) throw new Error('storage down');
      return 0;
    });
    expect(await f.runner.tick(t0)).toBe(1);
    expect(f.hook).not.toHaveBeenCalledWith(restored);
    expect(f.store.purgeRows).not.toHaveBeenCalledWith(restored);
    // The failing one is not finished: it stays claimed and backs off.
    expect(f.store.finish).not.toHaveBeenCalledWith(failing, expect.anything());
    expect(f.store.recordFailure).toHaveBeenCalledWith(failing, {
      error: 'Error',
      nextAt: new Date(t0.getTime() + 5 * MIN),
    });
    expect(f.store.finish).toHaveBeenCalledWith(ok, 5);
  });

  it('backs off exponentially from the attempts already failed, and stores only an error code', async () => {
    const ws = workspaceId(newId());
    const f = fakes([{ workspaceId: ws, attempts: 2 }]);
    const dbError = Object.assign(new Error('insert … params: 0901234567'), {
      cause: Object.assign(new Error('violates foreign key'), { code: '23503' }),
    });
    f.store.purgeRows.mockRejectedValue(dbError);
    expect(await f.runner.tick(t0)).toBe(0);
    // Third failure: 5 min × 2².
    expect(f.store.recordFailure).toHaveBeenCalledWith(ws, {
      error: 'Error:23503',
      nextAt: new Date(t0.getTime() + 20 * MIN),
    });
  });

  it('logs at error level once a business failed PURGE_ALERT_AFTER times', async () => {
    const ws = workspaceId(newId());
    const f = fakes([{ workspaceId: ws, attempts: PURGE_ALERT_AFTER - 2 }]);
    f.store.purgeRows.mockRejectedValue(new Error('down'));
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await f.runner.tick(t0);
      expect(error).not.toHaveBeenCalled();
      expect(warn.mock.calls.at(-1)?.[0]).toContain(ws);
      f.store.due.mockResolvedValue([{ workspaceId: ws, attempts: PURGE_ALERT_AFTER - 1 }]);
      await f.runner.tick(new Date(t0.getTime() + PURGE_SCAN_MS));
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toContain(ws);
      expect(String(error.mock.calls[0]?.[0])).not.toContain('down');
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it('holds the purge back while a deletion hook fails, then purges anyway after the alert threshold', async () => {
    const ws = workspaceId(newId());
    const f = fakes([ws]);
    f.hook.mockRejectedValue(new Error('meta down'));
    expect(await f.runner.tick(t0)).toBe(0);
    expect(f.store.purgeRows).not.toHaveBeenCalled();
    expect(f.store.recordFailure).toHaveBeenCalledWith(ws, {
      error: 'PurgeHooksFailedError:channel',
      nextAt: new Date(t0.getTime() + 5 * MIN),
    });
    f.store.due.mockResolvedValue([{ workspaceId: ws, attempts: PURGE_ALERT_AFTER - 1 }]);
    expect(await f.runner.tick(new Date(t0.getTime() + PURGE_SCAN_MS))).toBe(1);
    expect(f.store.purgeRows).toHaveBeenCalledWith(ws);
  });

  it('finishes without object storage when none is configured', async () => {
    const ws = workspaceId(newId());
    const f = fakes([ws], { storage: false });
    expect(await f.runner.tick(t0)).toBe(1);
    expect(f.objects.erase).not.toHaveBeenCalled();
  });
});

describe('purge back-off and error codes', () => {
  it('doubles from 5 minutes and caps at 24 hours', () => {
    expect(purgeBackoffMs(1)).toBe(5 * MIN);
    expect(purgeBackoffMs(2)).toBe(10 * MIN);
    expect(purgeBackoffMs(5)).toBe(80 * MIN);
    expect(purgeBackoffMs(9)).toBe(1280 * MIN);
    expect(purgeBackoffMs(10)).toBe(PURGE_BACKOFF_MAX_MS);
    expect(purgeBackoffMs(500)).toBe(PURGE_BACKOFF_MAX_MS);
  });

  it('keeps the class and SQLSTATE, never the message', () => {
    class DrizzleQueryError extends Error {}
    const e = new DrizzleQueryError('Failed query: delete … params: secret');
    Object.assign(e, { cause: { code: '42501', message: 'permission denied' } });
    expect(purgeErrorCode(e)).toBe('DrizzleQueryError:42501');
    expect(purgeErrorCode(Object.assign(new Error('x'), { code: 'not a code!' }))).toBe('Error');
    expect(purgeErrorCode('boom')).toBe('string');
  });
});
