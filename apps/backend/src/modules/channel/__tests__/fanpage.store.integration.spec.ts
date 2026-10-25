import {
  createDb,
  ensureLoginRoles,
  migrate,
  withCredentials,
  withTenant,
  withSystem,
  schema,
  sql,
  type Database,
} from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { FanpageSettings, type FanpageComment } from '@agent-sales/contracts';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { DrizzleFanpageStore } from '../infrastructure/persistence/fanpage.store.js';
let pg: TestPostgres, tenant: Database, store: DrizzleFanpageStore;
const handles: { close: () => Promise<void> }[] = [];
const a = workspaceId(newId()),
  b = workspaceId(newId()),
  connectionId = newId();
function open(url: string) {
  const h = createDb({ url, max: 3 });
  handles.push(h);
  return h.db;
}
beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenant = open(withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password));
  const system = open(withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password));
  for (const ws of [a, b]) {
    const userId = newId();
    await withSystem(system, (tx) =>
      tx
        .insert(schema.users)
        .values({ id: userId, email: `${userId}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenant, ws, (tx) =>
      tx
        .insert(schema.workspaces)
        .values({ id: ws, workspaceId: ws, name: 'Shop', industry: 'retail', ownerUserId: userId }),
    );
  }
  await withTenant(tenant, a, (tx) =>
    tx.insert(schema.channelConnections).values({
      id: connectionId,
      workspaceId: a,
      provider: 'facebook',
      externalId: '123',
      name: 'Page',
      tokenSealed: 'test-only',
    }),
  );
  store = new DrizzleFanpageStore(tenant);
});
afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});
function comment(): FanpageComment {
  return {
    id: newId(),
    connectionId,
    postId: '123_10',
    commentId: '10_20',
    parentId: null,
    authorId: '999',
    text: 'How much?',
    occurredAt: '2026-10-25T10:00:00.000Z',
    version: '2026-10-25T10:00:00.000Z/0/event1',
    deleted: false,
    needsReview: false,
    context: null,
    actions: [],
  };
}
describe('Fanpage persistence on PostgreSQL', () => {
  it('scopes settings and comment documents with RLS even when SQL omits workspace filtering', async () => {
    await store.saveSettings(a, connectionId, FanpageSettings.parse({ publicReplies: true }));
    const c = comment();
    await store.change(a, connectionId, c.commentId, () => ({ comment: c, result: undefined }));
    expect((await store.settings(a, connectionId)).publicReplies).toBe(true);
    expect((await store.settings(b, connectionId)).publicReplies).toBe(false);
    expect(await store.list(b, connectionId)).toEqual([]);
    const rows = await withTenant(tenant, b, (tx) =>
      tx.execute(sql`select * from fanpage_comments`),
    );
    expect(rows).toHaveLength(0);
  });
  it('serializes concurrent action reservations on the same comment', async () => {
    const reserve = (ws: WorkspaceId) =>
      store.change(ws, connectionId, '10_20', (c) => {
        if (!c) throw new Error('missing');
        if (c.actions.some((a) => a.kind === 'public_reply'))
          return { comment: null, result: false };
        return {
          comment: {
            ...c,
            actions: [
              ...c.actions,
              {
                id: newId(),
                kind: 'public_reply',
                status: 'pending',
                text: 'Hello',
                reason: 'test',
                externalId: null,
                recipientId: null,
                actorId: null,
                failureCode: null,
                createdAt: '2026-10-25T10:00:00.000Z',
              },
            ],
          },
          result: true,
        };
      });
    expect((await Promise.all([reserve(a), reserve(a)])).filter(Boolean)).toHaveLength(1);
  });
  it('detects edits ingested while the model is working', async () => {
    const c = (await store.list(a, connectionId))[0];
    if (!c) throw new Error('missing');
    await withTenant(tenant, a, (tx) =>
      tx.insert(schema.channelWebhookEvents).values({
        id: newId(),
        workspaceId: a,
        connectionId,
        externalId: 'edited',
        payload: {
          type: 'comment',
          externalEventId: 'edited',
          senderExternalId: '999',
          occurredAt: '2026-10-25T10:00:01.000Z',
          comment: { commentId: c.commentId, parentId: null, operation: 'edited' },
        },
      }),
    );
    expect(await store.interrupted(a, connectionId, c)).toBe(true);
  });
  it('looks up private provenance beyond the 100-comment staff window', async () => {
    const origin = comment();
    origin.commentId = '10_999';
    origin.context = {
      id: '123_10',
      pageId: '123',
      commentId: origin.commentId,
      text: '250k',
      parentText: '',
      media: [],
      permalink: '',
      fetchedAt: '2026-10-25T10:00:00.000Z',
    };
    origin.actions = [
      {
        id: newId(),
        kind: 'private_reply',
        status: 'sent',
        text: '250k',
        reason: 'test',
        externalId: 'reply',
        recipientId: 'psid',
        actorId: null,
        failureCode: null,
        createdAt: '2026-10-25T10:00:00.000Z',
      },
    ];
    await store.change(a, connectionId, origin.commentId, () => ({
      comment: origin,
      result: undefined,
    }));
    await withTenant(tenant, a, async (tx) => {
      for (let i = 0; i < 101; i++) {
        const c = { ...comment(), commentId: `10_${1000 + i}` };
        await tx.execute(
          sql`insert into fanpage_comments(workspace_id,connection_id,comment_id,document) values(${a},${connectionId},${c.commentId},${JSON.stringify(c)}::jsonb)`,
        );
      }
    });
    expect((await store.list(a, connectionId)).some((c) => c.commentId === origin.commentId)).toBe(
      false,
    );
    expect((await store.privateComments(a, connectionId, 'psid')).map((c) => c.commentId)).toEqual([
      origin.commentId,
    ]);
    expect(await store.privateComments(b, connectionId, 'psid')).toEqual([]);
  });
  it('remembers a completed staff reply delivered before the parent comment add', async () => {
    const c = { ...comment(), commentId: '10_5000' };
    // The staff event can be claimed and completed before its delayed parent event.
    await withTenant(tenant, a, (tx) =>
      tx.insert(schema.channelWebhookEvents).values({
        id: newId(),
        workspaceId: a,
        connectionId,
        externalId: 'early-staff',
        processedAt: new Date('2026-10-25T10:00:02.000Z'),
        payload: {
          type: 'comment',
          externalEventId: 'early-staff',
          senderExternalId: '123',
          text: 'Handled by staff',
          occurredAt: '2026-10-25T10:00:01.000Z',
          comment: { commentId: '5000_5001', parentId: c.commentId, operation: 'add' },
        },
      }),
    );
    await store.change(a, connectionId, c.commentId, () => ({ comment: c, result: undefined }));
    expect(await store.interrupted(a, connectionId, c)).toBe(true);
  });
  it('rejects writing foreign-tenant connection references even with a valid tenant context', async () => {
    const c = { ...comment(), commentId: '10_7000' };
    await expect(
      store.change(b, connectionId, c.commentId, () => ({ comment: c, result: undefined })),
    ).rejects.toThrow();
    expect(await store.list(b, connectionId)).toEqual([]);
  });
});
