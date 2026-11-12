import { metaUserHash } from '@agent-sales/channels';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { SecretBox } from '../../../common/security/secret-box.js';
import { MetaDataDeletionRunner } from '../application/meta-data-deletion.runner.js';
import type {
  ChannelStore,
  ConnectionRecord,
  DataDeletionRecord,
} from '../application/ports/channel-store.js';
import type { MetaGateway } from '../application/ports/meta-gateway.js';

const box: SecretBox = {
  seal: (v: string) => `sealed:${v}`,
  open: (v: string) => v.replace(/^sealed:/, ''),
} as unknown as SecretBox;
const lan = metaUserHash('10234567890123456');

function page(over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: newId(),
    workspaceId: workspaceId(newId()),
    provider: 'facebook',
    externalId: `page-${newId()}`,
    name: 'Page',
    status: 'connected',
    botId: null,
    expiresAt: null,
    settings: null,
    createdAt: new Date().toISOString(),
    tokenSealed: 'sealed:page-token',
    metaUserHash: lan,
    ...over,
  };
}

/** A store with pages and requests in memory, same rules as the Drizzle one. */
function store(pages: ConnectionRecord[], requests: Array<{ id: string; userHash: string }>) {
  const done = new Map<string, number>();
  const audits: unknown[] = [];
  const s = {
    claimDataDeletions: vi.fn(async () => requests.filter((r) => !done.has(r.id))),
    connectionsOfMetaUser: vi.fn(async (hash: string) =>
      pages.filter((p) => p.metaUserHash === hash && p.status !== 'removed'),
    ),
    remove: vi.fn(async (_ws, id: string, tokenSealed: string, audit?: unknown) => {
      const p = pages.find((x) => x.id === id && x.status !== 'removed');
      if (!p) return null;
      Object.assign(p, { status: 'removed', tokenSealed, botId: null, metaUserHash: null });
      audits.push(audit);
      return p;
    }),
    completeDataDeletion: vi.fn(async (id: string, n: number) => {
      done.set(id, n);
    }),
    dataDeletion: vi.fn(async (code: string): Promise<DataDeletionRecord | null> =>
      code === 'ABCDEF0123456789ABCDEF01'
        ? {
            confirmationCode: code,
            status: 'completed',
            requestedAt: new Date('2026-11-12T01:00:00Z'),
            completedAt: new Date('2026-11-12T01:01:00Z'),
            connectionsRemoved: 2,
          }
        : null,
    ),
  };
  return { s: s as unknown as ChannelStore, done, audits, raw: s };
}

describe('MetaDataDeletionRunner', () => {
  it('removes every page the person connected, in every business, and wipes the tokens', async () => {
    const mine = [page(), page({ provider: 'instagram' })];
    const someoneElse = page({ metaUserHash: metaUserHash('999') });
    const { s, done, audits } = store([...mine, someoneElse], [{ id: 'r1', userHash: lan }]);
    const unsubscribe = vi.fn(async () => undefined);
    const runner = new MetaDataDeletionRunner(s, { unsubscribe } as unknown as MetaGateway, box);

    expect(await runner.tick()).toBe(1);

    expect(done.get('r1')).toBe(2);
    for (const p of mine) expect(p).toMatchObject({ status: 'removed', tokenSealed: 'sealed:' });
    expect(someoneElse).toMatchObject({ status: 'connected', tokenSealed: 'sealed:page-token' });
    // The subscription is dropped with the token before it is wiped.
    expect(unsubscribe).toHaveBeenCalledWith('facebook', {
      externalId: mine[0]?.externalId,
      token: 'page-token',
    });
    expect(audits).toEqual([
      {
        action: 'channel.removed',
        data: { reason: 'meta_data_deletion', provider: 'facebook', requestId: 'r1' },
      },
      {
        action: 'channel.removed',
        data: { reason: 'meta_data_deletion', provider: 'instagram', requestId: 'r1' },
      },
    ]);
  });

  it('is idempotent: the same person asking again finds nothing left to remove', async () => {
    const pages = [page()];
    const first = store(pages, [{ id: 'r1', userHash: lan }]);
    const gateway = { unsubscribe: vi.fn(async () => undefined) } as unknown as MetaGateway;
    await new MetaDataDeletionRunner(first.s, gateway, box).tick();
    const again = store(pages, [{ id: 'r2', userHash: lan }]);
    await new MetaDataDeletionRunner(again.s, gateway, box).tick();
    expect(again.done.get('r2')).toBe(0);
    expect(again.audits).toEqual([]);
  });

  it('still removes the page when Meta refuses the unsubscribe', async () => {
    const p = page();
    const { s, done } = store([p], [{ id: 'r1', userHash: lan }]);
    const gateway = {
      unsubscribe: vi.fn(async () => {
        throw new Error('expired');
      }),
    } as unknown as MetaGateway;
    await new MetaDataDeletionRunner(s, gateway, box).tick();
    expect(p.status).toBe('removed');
    expect(done.get('r1')).toBe(1);
  });

  it('leaves the request pending when the database fails, for the next tick', async () => {
    const { s, done, raw } = store([page()], [{ id: 'r1', userHash: lan }]);
    raw.connectionsOfMetaUser.mockRejectedValueOnce(new Error('db down'));
    const runner = new MetaDataDeletionRunner(
      s,
      { unsubscribe: vi.fn() } as unknown as MetaGateway,
      box,
    );
    await runner.tick();
    expect(done.has('r1')).toBe(false);
    await runner.tick();
    expect(done.get('r1')).toBe(1);
  });

  it('answers the public status and 404 for unknown or malformed codes', async () => {
    const { s } = store([], []);
    const runner = new MetaDataDeletionRunner(s, {} as MetaGateway, box);
    expect(await runner.status('ABCDEF0123456789ABCDEF01')).toEqual({
      confirmationCode: 'ABCDEF0123456789ABCDEF01',
      status: 'completed',
      requestedAt: '2026-11-12T01:00:00.000Z',
      completedAt: '2026-11-12T01:01:00.000Z',
      connectionsRemoved: 2,
    });
    await expect(runner.status('ABCDEF0123456789ABCDEF02')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(runner.status("x' or 1=1")).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
