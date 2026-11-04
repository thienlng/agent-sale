import {
  CreatedInvitation,
  NotificationCount,
  NotificationDto,
  NotificationList,
} from '@agent-sales/contracts';
import { eq, schema } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './support/harness.js';

/**
 * The notification routes over HTTP on Postgres (T-172, 3-P5): the current business gives the
 * account, a user only ever sees their own rows, and another user's or account's id is 404.
 */
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.stop();
});

async function accountOf(workspaceId: string): Promise<string> {
  const [row] = await h.owner.db
    .select({ accountId: schema.workspaces.accountId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  return row?.accountId ?? '';
}

async function seed(u: TestUser, workspaceId: string, count: number): Promise<string[]> {
  const accountId = await accountOf(workspaceId);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = newId();
    ids.push(id);
    await h.owner.db.insert(schema.notifications).values({
      id,
      accountId,
      userId: u.userId,
      workspaceId,
      type: 'assistant.report',
      title: `Báo cáo ${i}`,
      body: 'Doanh thu: 1.250.000 ₫',
      target: { kind: 'path', path: '/app/orders' },
      createdAt: new Date(Date.UTC(2026, 10, 2, 1, i)),
    });
  }
  return ids;
}

async function invite(o: TestUser, invitee: TestUser, role: string) {
  await h.owner.db
    .insert(schema.workspaceEntitlementOverrides)
    .values({ workspaceId: o.ownWorkspace, key: 'members.max', value: 50, reason: 'test' })
    .onConflictDoNothing();
  const inv = await h.call(o.h, 'POST', '/invitations', { email: invitee.email, role });
  expect(inv.statusCode, inv.body).toBe(201);
  const { token } = CreatedInvitation.parse(inv.json());
  const accepted = await h.call(invitee.auth, 'POST', '/invitation-links/accept', { token });
  expect(accepted.statusCode, accepted.body).toBe(200);
}

describe('notification routes', () => {
  it('lists by keyset, counts unread and marks read', async () => {
    const lan = await h.user('lan@notify.vn', 'Lan');
    const ids = await seed(lan, lan.ownWorkspace, 3);

    const page1 = await h.call(lan.h, 'GET', '/notifications?limit=2');
    expect(page1.statusCode, page1.body).toBe(200);
    const list1 = NotificationList.parse(page1.json());
    expect(list1.items.map((x) => x.title)).toEqual(['Báo cáo 2', 'Báo cáo 1']);
    expect(list1.next).not.toBeNull();
    const page2 = NotificationList.parse(
      (
        await h.call(
          lan.h,
          'GET',
          `/notifications?limit=2&before=${encodeURIComponent(list1.next!.before)}&beforeId=${list1.next!.beforeId}`,
        )
      ).json(),
    );
    expect(page2.items.map((x) => x.title)).toEqual(['Báo cáo 0']);
    expect(page2.next).toBeNull();

    const count = await h.call(lan.h, 'GET', '/notifications/unread-count');
    expect(NotificationCount.parse(count.json())).toEqual({ count: 3 });

    const read = await h.call(lan.h, 'POST', `/notifications/${ids[0]}/read`);
    expect(read.statusCode, read.body).toBe(200);
    expect(NotificationDto.parse(read.json()).readAt).not.toBeNull();

    const all = await h.call(lan.h, 'POST', '/notifications/read-all');
    expect(all.statusCode, all.body).toBe(200);
    expect(NotificationCount.parse(all.json())).toEqual({ count: 2 });
    expect(
      NotificationCount.parse((await h.call(lan.h, 'GET', '/notifications/unread-count')).json()),
    ).toEqual({ count: 0 });
  });

  it('answers 400 on an invalid query', async () => {
    const an = await h.user('an@notify.vn', 'An');
    expect((await h.call(an.h, 'GET', '/notifications?limit=500')).statusCode).toBe(400);
    expect((await h.call(an.h, 'GET', `/notifications?beforeId=${newId()}`)).statusCode).toBe(400);
  });

  it("lets staff read only their own rows; another user's or account's id is 404", async () => {
    const binh = await h.user('binh@notify.vn', 'Binh');
    const chi = await h.user('chi@notify.vn', 'Chi');
    await invite(binh, chi, 'sales');
    const [ownerNote] = await seed(binh, binh.ownWorkspace, 1);

    // Chi, staff in Binh's business, sees none of Binh's notifications and cannot mark them.
    const asChi = chi.in(binh.ownWorkspace);
    const list = await h.call(asChi, 'GET', '/notifications');
    expect(list.statusCode, list.body).toBe(200);
    expect(NotificationList.parse(list.json()).items).toEqual([]);
    expect((await h.call(asChi, 'POST', `/notifications/${ownerNote}/read`)).statusCode).toBe(404);
    expect(
      NotificationCount.parse((await h.call(asChi, 'POST', '/notifications/read-all')).json()),
    ).toEqual({ count: 0 });

    // Another account's owner: 404, and their own list stays empty.
    const dung = await h.user('dung@notify.vn', 'Dung');
    expect((await h.call(dung.h, 'POST', `/notifications/${ownerNote}/read`)).statusCode).toBe(404);
    expect((await h.call(dung.h, 'POST', '/notifications/not-a-uuid/read')).statusCode).toBe(404);
    // Binh's row is still unread.
    expect(
      NotificationCount.parse((await h.call(binh.h, 'GET', '/notifications/unread-count')).json()),
    ).toEqual({ count: 1 });
  });

  it('refuses a caller without a token', async () => {
    expect((await h.call({}, 'GET', '/notifications')).statusCode).toBe(401);
  });
});
