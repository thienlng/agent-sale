import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type {
  BusinessObjectEraser,
  WorkspacePurgeStore,
} from '../application/ports/workspace-purge.js';
import { PURGE_SCAN_MS, WorkspacePurgeRunnerImpl } from '../application/workspace-purge.runner.js';

function fakes(due: WorkspaceId[], opts: { storage?: boolean } = {}) {
  const store = {
    due: vi.fn(async () => due),
    stillDue: vi.fn(async (_ws: WorkspaceId) => true),
    purgeRows: vi.fn(async (_ws: WorkspaceId) => ({ contacts: 3, orders: 2 })),
    finish: vi.fn(async (_ws: WorkspaceId, _rows: number) => true),
  } satisfies WorkspacePurgeStore;
  const objects = {
    available: vi.fn(() => opts.storage ?? true),
    erase: vi.fn(async (_ws: WorkspaceId) => 4),
  } satisfies BusinessObjectEraser;
  return { store, objects, runner: new WorkspacePurgeRunnerImpl(store, objects) };
}

const t0 = new Date('2026-12-12T03:00:00Z');

describe('WorkspacePurgeRunnerImpl', () => {
  it('purges rows, then files, then writes the tombstone, for every due business', async () => {
    const [a, b] = [workspaceId(newId()), workspaceId(newId())];
    const f = fakes([a, b]);
    expect(await f.runner.tick(t0)).toBe(2);
    expect(f.store.purgeRows).toHaveBeenCalledWith(a);
    expect(f.objects.erase).toHaveBeenCalledWith(b);
    expect(f.store.finish).toHaveBeenCalledWith(a, 5);
    const order = [
      f.store.purgeRows.mock.invocationCallOrder[0],
      f.objects.erase.mock.invocationCallOrder[0],
      f.store.finish.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((x = 0, y = 0) => x - y));
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
    f.store.stillDue.mockImplementation(async (ws) => ws !== restored);
    f.objects.erase.mockImplementation(async (ws) => {
      if (ws === failing) throw new Error('storage down');
      return 0;
    });
    expect(await f.runner.tick(t0)).toBe(1);
    expect(f.store.purgeRows).not.toHaveBeenCalledWith(restored);
    // The failing one is not finished: it stays pending and the next scan retries it.
    expect(f.store.finish).not.toHaveBeenCalledWith(failing, expect.anything());
    expect(f.store.finish).toHaveBeenCalledWith(ok, 5);
  });

  it('finishes without object storage when none is configured', async () => {
    const ws = workspaceId(newId());
    const f = fakes([ws], { storage: false });
    expect(await f.runner.tick(t0)).toBe(1);
    expect(f.objects.erase).not.toHaveBeenCalled();
  });
});
