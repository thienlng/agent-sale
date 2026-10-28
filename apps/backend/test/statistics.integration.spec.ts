import {
  AnalyticsResponse,
  ContactDto,
  CreatedInvitation,
  DrilldownResponse,
  type MetricKey,
  TagAssignmentDto,
  TagDto,
} from '@agent-sales/contracts';
import { schema } from '@agent-sales/db';
import { localDate } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './support/harness.js';

/** Statistics queries on a real Postgres (T-041): definitions in action, scope, drilldown, boundaries. */
let t: Harness;
beforeAll(async () => {
  t = await startHarness();
});
afterAll(async () => {
  await t?.stop();
});

const TZ = 'Asia/Ho_Chi_Minh';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (offset: number) => localDate(new Date(Date.now() + offset * 86_400_000), TZ);

const base = (extra: object = {}) => ({
  definitionVersion: 1,
  metrics: ['customers.new'] as MetricKey[],
  dateRange: { from: day(-1), to: day(1) },
  ...extra,
});
const ask = async (u: TestUser, body: object) => {
  const res = await t.call(u.h, 'POST', '/analytics/query', body);
  expect(res.statusCode, res.body).toBe(200);
  return AnalyticsResponse.parse(res.json());
};
const drill = async (u: TestUser, body: object) => {
  const res = await t.call(u.h, 'POST', '/analytics/drilldown', body);
  expect(res.statusCode, res.body).toBe(200);
  return DrilldownResponse.parse(res.json());
};
const card = (r: AnalyticsResponse, key: MetricKey) => {
  const c = r.cards.find((x) => x.key === key);
  if (c?.state !== 'ok') throw new Error(`${key} is not ok`);
  return c.value;
};
const issues = async (u: TestUser, path: string, body: object) => {
  const res = await t.call(u.h, 'POST', path, body);
  expect(res.statusCode, res.body).toBe(400);
  return (res.json().error.details.issues as Array<{ code: string; metric?: string }>).map(
    (i) => `${i.code}${i.metric ? `:${i.metric}` : ''}`,
  );
};

async function allowSeats(workspaceId: string, seats: number) {
  await t.owner.db
    .insert(schema.workspaceEntitlementOverrides)
    .values({ workspaceId, key: 'members.max', value: seats, reason: 'test' });
}
async function join(owner: TestUser, member: TestUser, role: string) {
  const inv = await t.call(owner.h, 'POST', '/invitations', { email: member.email, role });
  expect(inv.statusCode, inv.body).toBe(201);
  const { token } = CreatedInvitation.parse(inv.json());
  const ok = await t.call(member.auth, 'POST', '/invitation-links/accept', { token });
  expect(ok.statusCode, ok.body).toBe(200);
}
/** A member of another user's shop, acting in it. */
const member = (u: TestUser, workspaceId: string): TestUser => ({ ...u, h: u.in(workspaceId) });
const contact = async (u: TestUser, body: object) =>
  ContactDto.parse((await t.call(u.h, 'POST', '/contacts', body)).json());

describe('statistics', () => {
  it('answers every metric from one set of facts: events, snapshots, owners, scope', async () => {
    const lan = await t.user('lan@st.vn', 'Chủ shop Lan');
    const binh = await t.user('binh@st.vn', 'Sales Bình');
    const an = await t.user('an@st.vn', 'Phân tích An');
    await allowSeats(lan.ownWorkspace, 10);
    await join(lan, binh, 'sales');
    await join(lan, an, 'analyst');

    const c1 = await contact(lan, { name: 'Khách 1', salesUserId: binh.userId });
    const c2 = await contact(lan, { name: 'Khách 2', salesUserId: binh.userId });
    const c3 = await contact(lan, { name: 'Khách 3' });
    await contact(lan, { name: 'Khách 4', salesUserId: lan.userId });

    const tag = async (name: string) =>
      TagDto.parse(
        (await t.call(lan.h, 'POST', '/crm/tags', { name, type: 'classification' })).json(),
      );
    const t1 = await tag('VIP-ST');
    const t2 = await tag('Sỉ-ST');
    const assign = async (c: { id: string }, tagId: string) =>
      TagAssignmentDto.parse(
        (await t.call(lan.h, 'POST', `/contacts/${c.id}/tags`, { tagId })).json(),
      );
    await assign(c1, t1.id);
    await assign(c1, t2.id);
    const gone = await assign(c2, t1.id);
    await t.call(lan.h, 'POST', `/tag-assignments/${gone.id}/remove`, { reason: 'nhầm' });
    // Khách 1 changes hands after it was created.
    const moved = await t.call(lan.h, 'PATCH', `/contacts/${c1.id}`, {
      salesUserId: lan.userId,
      expectedVersion: 1 + 0,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const statuses = (await t.call(lan.h, 'GET', '/crm/statuses')).json() as {
      data: Array<{ id: string }>;
    };
    const status = statuses.data[0]?.id as string;
    await t.call(lan.h, 'PATCH', `/contacts/${c3.id}`, { statusId: status, expectedVersion: 1 });

    const everything = base({
      metrics: [
        'customers.new',
        'tags.assigned',
        'tags.removed',
        'tags.net',
        'tags.current',
        'statuses.changed',
      ],
      origins: ['manual', 'rule'],
    });
    const all = await ask(lan, everything);
    // Manual customers are not channel customers: the default origin counts none of them.
    expect(card(await ask(lan, base()), 'customers.new')).toBe(0);
    expect(card(await ask(lan, base({ origins: ['manual'] })), 'customers.new')).toBe(4);
    expect(card(all, 'customers.new')).toBe(4);
    // Events: 3 added, 1 removed. Snapshot: only Khách 1 still has tags.
    expect(card(all, 'tags.assigned')).toBe(3);
    expect(card(all, 'tags.removed')).toBe(1);
    expect(card(all, 'tags.net')).toBe(2);
    expect(card(all, 'tags.current')).toBe(1);
    expect(card(all, 'statuses.changed')).toBe(1);
    // Two tags on one customer: the breakdown rows overlap, the total is the distinct customer count.
    expect(all.breakdowns.currentTags.map((r) => r.count)).toEqual([1, 1]);
    expect(all.distinctTotals['tags.current']).toBe(1);
    expect(all.breakdowns.tags.find((r) => r.tagId === t1.id)).toMatchObject({
      assigned: 2,
      removed: 1,
      net: 1,
    });
    // Statuses: one per customer, so the rows add up to the card. (No origin applies to a snapshot.)
    const statusRes = await ask(lan, base({ metrics: ['statuses.current'] }));
    expect(card(statusRes, 'statuses.current')).toBe(4);
    expect(statusRes.breakdowns.statuses.reduce((n, r) => n + r.count, 0)).toBe(4);
    expect(statusRes.breakdowns.statuses.find((r) => r.statusId === status)?.count).toBe(1);
    expect(
      await issues(
        lan,
        '/analytics/query',
        base({ metrics: ['statuses.current'], origins: ['manual'] }),
      ),
    ).toEqual(['origin_not_allowed:statuses.current']);
    // The series covers every local day, zero-filled, and sums to the card.
    expect(all.series).toHaveLength(3);
    expect(all.series.reduce((n, p) => n + (p.values['customers.new'] ?? 0), 0)).toBe(4);
    expect(all.meta).toMatchObject({
      definitionVersion: 1,
      timezone: TZ,
      scope: 'all',
      lagSeconds: 0,
    });
    expect(all.meta.watermarkId).toBeGreaterThan(0);

    // Attribution: the salesperson at creation, not the current owner.
    const forBinh = await ask(lan, base({ origins: ['manual'], salesIds: [binh.userId] }));
    expect(card(forBinh, 'customers.new')).toBe(2);
    const forLan = await ask(lan, base({ origins: ['manual'], salesIds: [lan.userId] }));
    expect(card(forLan, 'customers.new')).toBe(1);
    // Snapshots use the owner now: Khách 1 belongs to Lan today.
    const snapLan = await ask(lan, base({ metrics: ['tags.current'], salesIds: [lan.userId] }));
    expect(card(snapLan, 'tags.current')).toBe(1);
    const snapBinh = await ask(lan, base({ metrics: ['tags.current'], salesIds: [binh.userId] }));
    expect(card(snapBinh, 'tags.current')).toBe(0);
    const bySales = await ask(lan, base({ origins: ['manual'] }));
    expect(
      bySales.breakdowns.bySales.map((r) => [r.salesUserId, r.values['customers.new']]).sort(),
    ).toEqual(
      [
        [binh.userId, 2],
        [lan.userId, 1],
        [null, 1],
      ].sort(),
    );

    // Scope: a salesperson sees what they own or nobody owns; an analyst sees everything.
    const asBinh = await ask(member(binh, lan.ownWorkspace), base({ origins: ['manual'] }));
    expect(asBinh.meta.scope).toBe('own');
    expect(card(asBinh, 'customers.new')).toBe(2); // Khách 2 (his) and Khách 3 (nobody's)
    expect(
      card(await ask(member(an, lan.ownWorkspace), base({ origins: ['manual'] })), 'customers.new'),
    ).toBe(4);
    const names = (
      await drill(member(binh, lan.ownWorkspace), {
        query: base({ origins: ['manual'] }),
        metric: 'customers.new',
      })
    ).rows
      .map((r) => r.contactName)
      .sort();
    expect(names).toEqual(['Khách 2', 'Khách 3']);

    // Drilldown reproduces the card, page by page, without repeats.
    const q = base({ origins: ['manual'] });
    const first = await drill(lan, { query: q, metric: 'customers.new', limit: 3 });
    expect(first.total).toBe(card(all, 'customers.new'));
    expect(first.rows).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await drill(lan, {
      query: q,
      metric: 'customers.new',
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.rows, ...second.rows].map((r) => r.contactId);
    expect(new Set(ids).size).toBe(4);
    // Narrowing by a breakdown row.
    const hers = await drill(lan, {
      query: q,
      metric: 'customers.new',
      dimension: { salesUserId: binh.userId },
    });
    expect(hers.total).toBe(2);
    expect(hers.rows.map((r) => r.contactName).sort()).toEqual(['Khách 1', 'Khách 2']);
    const unowned = await drill(lan, {
      query: q,
      metric: 'customers.new',
      dimension: { salesUserId: null },
    });
    expect(unowned.rows.map((r) => r.contactName)).toEqual(['Khách 3']);
    // A snapshot card lists each customer once, however many tags they have.
    const tagged = await drill(lan, {
      query: base({ metrics: ['tags.current'] }),
      metric: 'tags.current',
    });
    expect(tagged.total).toBe(1);
    expect(tagged.rows).toHaveLength(1);
    expect(tagged.rows[0]).toMatchObject({ contactName: 'Khách 1' });
    const byTag = await drill(lan, {
      query: base({ metrics: ['tags.current'] }),
      metric: 'tags.current',
      dimension: { tagId: t2.id },
    });
    expect(byTag.rows.map((r) => r.contactName)).toEqual(['Khách 1']);
    const inStatus = await drill(lan, {
      query: base({ metrics: ['statuses.current'] }),
      metric: 'statuses.current',
      dimension: { statusId: status },
    });
    expect(inStatus.rows.map((r) => r.contactName)).toEqual(['Khách 3']);

    // A frozen watermark keeps a drilldown equal to the card it came from, whatever happens next.
    await contact(lan, { name: 'Khách 5' });
    const frozen = await drill(lan, {
      query: base({ origins: ['manual'], watermark: all.meta.watermarkId }),
      metric: 'customers.new',
    });
    expect(frozen.total).toBe(4);
    expect(card(await ask(lan, base({ origins: ['manual'] })), 'customers.new')).toBe(5);
  });

  it('a tag added then removed is 2 events, 0 current and 0 net; the past shows the tag', async () => {
    const lan = await t.user('lan2@st.vn', 'Chủ shop');
    const c = await contact(lan, { name: 'Khách X' });
    const tag = TagDto.parse(
      (await t.call(lan.h, 'POST', '/crm/tags', { name: 'T-ST', type: 'classification' })).json(),
    );
    const added = TagAssignmentDto.parse(
      (await t.call(lan.h, 'POST', `/contacts/${c.id}/tags`, { tagId: tag.id })).json(),
    );
    await wait(40);
    const mid = new Date().toISOString();
    await wait(40);
    await t.call(lan.h, 'POST', `/tag-assignments/${added.id}/remove`, {});

    const now = await ask(
      lan,
      base({ metrics: ['tags.assigned', 'tags.removed', 'tags.net', 'tags.current'] }),
    );
    expect(card(now, 'tags.assigned') + card(now, 'tags.removed')).toBe(2);
    expect(card(now, 'tags.net')).toBe(0);
    expect(card(now, 'tags.current')).toBe(0);
    // Before the removal the same customer still had the tag.
    const past = await ask(lan, base({ metrics: ['tags.current'], asOf: mid }));
    expect(card(past, 'tags.current')).toBe(1);
    expect(past.breakdowns.currentTags).toEqual([{ tagId: tag.id, count: 1 }]);
  });

  it('places events on local days with half-open boundaries and filters by page', async () => {
    const lan = await t.user('lan3@st.vn', 'Chủ shop');
    const pageA = crypto.randomUUID();
    const pageB = crypto.randomUUID();
    const at = (iso: string, channelId: string, n: number) =>
      t.owner.db.insert(schema.outboxEvents).values({
        workspaceId: lan.ownWorkspace,
        type: 'conversation.message.received.v1',
        aggregateType: 'conversation',
        aggregateId: crypto.randomUUID(),
        payload: {
          messageId: `b-${n}`,
          type: 'message',
          channelId,
          occurredAt: iso,
          firstMessage: n === 1,
        },
      });
    // Local time is UTC+7: 16:59:59Z is the last second of a local day, 17:00:00Z the first of the next.
    await at('2026-10-20T16:59:59.000Z', pageA, 1);
    await at('2026-10-20T17:00:00.000Z', pageA, 2);
    await at('2026-10-21T16:59:59.999Z', pageB, 3);
    await at('2026-10-21T17:00:00.000Z', pageA, 4);

    const one = await ask(
      lan,
      base({
        metrics: ['messages.inbound', 'conversations.opened'],
        dateRange: { from: '2026-10-21', to: '2026-10-21' },
      }),
    );
    expect(one.meta.range).toMatchObject({
      fromUtc: '2026-10-20T17:00:00.000Z',
      toUtc: '2026-10-21T17:00:00.000Z',
    });
    expect(card(one, 'messages.inbound')).toBe(2);
    expect(card(one, 'conversations.opened')).toBe(0);

    const three = await ask(
      lan,
      base({ metrics: ['messages.inbound'], dateRange: { from: '2026-10-20', to: '2026-10-22' } }),
    );
    expect(three.series.map((p) => [p.date, p.values['messages.inbound']])).toEqual([
      ['2026-10-20', 1],
      ['2026-10-21', 2],
      ['2026-10-22', 1],
    ]);
    // By page: the filter and the breakdown agree.
    const a = await ask(
      lan,
      base({
        metrics: ['messages.inbound'],
        dateRange: { from: '2026-10-20', to: '2026-10-22' },
        pageIds: [pageA],
      }),
    );
    expect(card(a, 'messages.inbound')).toBe(3);
    expect(
      three.breakdowns.byPage.map((r) => [r.channelId, r.values['messages.inbound']]).sort(),
    ).toEqual(
      [
        [pageA, 3],
        [pageB, 1],
      ].sort(),
    );
    const drilled = await drill(lan, {
      query: base({
        metrics: ['messages.inbound'],
        dateRange: { from: '2026-10-20', to: '2026-10-22' },
      }),
      metric: 'messages.inbound',
      dimension: { channelId: pageB },
    });
    expect(drilled.total).toBe(1);
    expect(drilled.rows[0]).toMatchObject({ channelId: pageB, contactId: null, contactName: null });
    const oneDay = await drill(lan, {
      query: base({
        metrics: ['messages.inbound'],
        dateRange: { from: '2026-10-20', to: '2026-10-22' },
      }),
      metric: 'messages.inbound',
      dimension: { date: '2026-10-21' },
    });
    expect(oneDay.total).toBe(2);
  });

  it('keeps history with the bot that answered it after the page is rebound, per tenant', async () => {
    const lan = await t.user('lanbot@st.vn', 'Chủ shop');
    const minh = await t.user('minhbot@st.vn', 'Chủ shop');
    const page = crypto.randomUUID();
    const before = crypto.randomUUID();
    const after = crypto.randomUUID();
    const at = (iso: string, botId: string, n: number) =>
      t.owner.db.insert(schema.outboxEvents).values({
        workspaceId: lan.ownWorkspace,
        type: 'conversation.message.received.v1',
        aggregateType: 'conversation',
        aggregateId: crypto.randomUUID(),
        payload: {
          messageId: `bot-${n}`,
          type: 'message',
          channelId: page,
          botId,
          occurredAt: iso,
        },
      });
    // The same page answered by one bot, then rebound to another.
    await at('2026-10-20T03:00:00.000Z', before, 1);
    await at('2026-10-20T04:00:00.000Z', before, 2);
    await at('2026-10-21T03:00:00.000Z', after, 3);
    const range = { from: '2026-10-20', to: '2026-10-21' };
    const count = async (u: TestUser, botIds: string[]) =>
      card(
        await ask(u, base({ metrics: ['messages.inbound'], dateRange: range, botIds })),
        'messages.inbound',
      );

    expect(await count(lan, [before])).toBe(2);
    expect(await count(lan, [after])).toBe(1);
    expect(await count(lan, [before, after])).toBe(3);
    // Another business naming these bots sees nothing and learns nothing.
    expect(await count(minh, [before, after])).toBe(0);
    expect(
      await issues(lan, '/analytics/query', base({ metrics: ['customers.new'], botIds: [before] })),
    ).toEqual(['scope_not_supported:customers.new']);
  });

  it('refuses what the definitions do not allow, and says exactly what', async () => {
    const lan = await t.user('lan4@st.vn', 'Chủ shop');
    expect(await issues(lan, '/analytics/query', base({ metrics: ['comments.received'] }))).toEqual(
      ['metric_unavailable:comments.received'],
    );
    expect(await issues(lan, '/analytics/query', base({ definitionVersion: 7 }))).toEqual([
      'version_mismatch',
    ]);
    expect(await issues(lan, '/analytics/query', base({ pageIds: [crypto.randomUUID()] }))).toEqual(
      ['scope_not_supported:customers.new'],
    );
    expect(
      await issues(
        lan,
        '/analytics/query',
        base({ metrics: ['messages.inbound'], salesIds: [crypto.randomUUID()] }),
      ),
    ).toEqual(['scope_not_supported:messages.inbound']);
    expect(
      await issues(lan, '/analytics/query', base({ dateRange: { from: day(1), to: day(-1) } })),
    ).toEqual(['range_invalid']);
    expect(
      await issues(lan, '/analytics/drilldown', {
        query: base({ metrics: ['tags.net'] }),
        metric: 'tags.net',
      }),
    ).toEqual(['not_drillable:tags.net']);
    expect(
      await issues(lan, '/analytics/drilldown', {
        query: base(),
        metric: 'customers.new',
        dimension: { tagId: crypto.randomUUID() },
      }),
    ).toEqual(['scope_not_supported:customers.new']);
    // Nothing recorded yet is a real zero, with every day present — not an error and not missing.
    const empty = await ask(lan, base({ origins: ['manual'] }));
    expect(card(empty, 'customers.new')).toBe(0);
    expect(empty.series).toHaveLength(3);
  });

  it('keeps shops apart', async () => {
    const lan = await t.user('lan5@st.vn', 'Chủ shop');
    const other = await t.user('other5@st.vn', 'Shop khác');
    await contact(lan, { name: 'Khách riêng' });
    expect(card(await ask(lan, base({ origins: ['manual'] })), 'customers.new')).toBe(1);
    const theirs = await ask(other, base({ origins: ['manual'] }));
    expect(card(theirs, 'customers.new')).toBe(0);
    const rows = await drill(other, {
      query: base({ origins: ['manual'] }),
      metric: 'customers.new',
    });
    expect(rows).toMatchObject({ total: 0, rows: [] });
    // Without the capability there is no access at all.
    const nobody = await t.call(
      { authorization: other.auth['authorization'] ?? '', 'x-workspace-id': lan.ownWorkspace },
      'POST',
      '/analytics/query',
      base(),
    );
    expect(nobody.statusCode).toBe(404);
  });

  it('concurrent queries all see what was just done, however they race for the projector', async () => {
    const lan = await t.user('lan6@st.vn', 'Chủ shop');
    const c = await contact(lan, { name: 'Khách Y', phone: '0905555555' });
    const tag = TagDto.parse(
      (await t.call(lan.h, 'POST', '/crm/tags', { name: 'T-RACE', type: 'classification' })).json(),
    );
    await t.call(lan.h, 'POST', `/contacts/${c.id}/tags`, { tagId: tag.id });
    // The page sends its three queries together; every one must include the newest events.
    const [people, tags, tags2, tags3] = await Promise.all([
      ask(lan, base({ metrics: ['customers.new', 'phones.captured'] })),
      ask(lan, base({ metrics: ['tags.assigned', 'tags.current'] })),
      ask(lan, base({ metrics: ['tags.assigned'] })),
      ask(lan, base({ metrics: ['tags.current'] })),
    ]);
    expect(card(people, 'customers.new')).toBe(0); // channel only: the CRM customer is manual
    expect(card(people, 'phones.captured')).toBe(0);
    for (const r of [tags, tags2]) expect(card(r, 'tags.assigned')).toBe(1);
    expect(card(tags, 'tags.current')).toBe(1);
    expect(card(tags3, 'tags.current')).toBe(1);
  });

  it('a watermark chosen by the caller cannot widen what an own-scope viewer may see', async () => {
    const lan = await t.user('lan7@st.vn', 'Chủ shop');
    const binh = await t.user('binh7@st.vn', 'Sales Bình');
    await allowSeats(lan.ownWorkspace, 10);
    await join(lan, binh, 'sales');
    const mine = member(binh, lan.ownWorkspace);

    await contact(lan, { name: 'Khách trống' });
    const secret = await contact(lan, { name: 'Khách của Lan' });
    // Nobody owns "Khách của Lan" at this watermark…
    const before = await ask(lan, base({ origins: ['manual'] }));
    // …then it is given to Lan, so Bình may no longer see it.
    const moved = await t.call(lan.h, 'PATCH', `/contacts/${secret.id}`, {
      salesUserId: lan.userId,
      expectedVersion: 1,
    });
    expect(moved.statusCode, moved.body).toBe(200);

    const now = await drill(mine, {
      query: base({ origins: ['manual'] }),
      metric: 'customers.new',
    });
    expect(now.rows.map((r) => r.contactName)).toEqual(['Khách trống']);
    // Naming the older watermark does not bring it back, in the rows, the names or the card.
    const stale = base({ origins: ['manual'], watermark: before.meta.watermarkId });
    const frozen = await drill(mine, { query: stale, metric: 'customers.new' });
    expect(frozen.rows.map((r) => r.contactName)).toEqual(['Khách trống']);
    expect(frozen.total).toBe(1);
    expect(card(await ask(mine, stale), 'customers.new')).toBe(1);
  });
});
