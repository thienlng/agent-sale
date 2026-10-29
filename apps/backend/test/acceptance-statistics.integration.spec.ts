import { AnalyticsResponse, DrilldownResponse, type MetricKey } from '@agent-sales/contracts';
import { eq, schema } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectorService } from '../src/modules/analytics/application/projector.service.js';
import {
  AS_OF,
  D1,
  D2,
  local,
  seedGolden,
  seedPortfolioBusiness,
} from './support/acceptance-statistics.js';
import { type Harness, startHarness, type TestUser } from './support/harness.js';

let t: Harness;
let owner: TestUser;
let g: Awaited<ReturnType<typeof seedGolden>>;
const people: MetricKey[] = ['customers.new', 'phones.captured'];
const tags: MetricKey[] = [
  'tags.assigned',
  'tags.removed',
  'tags.net',
  'tags.current',
  'statuses.changed',
];
const messages: MetricKey[] = ['conversations.opened', 'messages.inbound', 'messages.outbound'];
const range = { from: D1, to: D2 };
const query = (metrics: MetricKey[], extra: object = {}) => ({
  definitionVersion: 1,
  metrics,
  dateRange: range,
  asOf: AS_OF,
  ...extra,
});
const value = (r: AnalyticsResponse, key: MetricKey) => {
  const c = r.cards.find((x) => x.key === key);
  if (c?.state !== 'ok') throw new Error(`Expected available ${key}`);
  return c.value;
};
const ask = async (metrics: MetricKey[], extra: object = {}, actor = owner) => {
  const r = await t.call(actor.h, 'POST', '/analytics/query', query(metrics, extra));
  expect(r.statusCode, r.body).toBe(200);
  return AnalyticsResponse.parse(r.json());
};

beforeAll(async () => {
  t = await startHarness();
  owner = await t.user('golden-owner@acceptance.test', 'Golden Owner');
  const sales = await t.user('golden-sales@acceptance.test', 'Golden Sales');
  g = await seedGolden(t, owner, sales.userId);
});
afterAll(async () => {
  await t?.stop();
});

describe('T-126 independent source-ledger statistics acceptance', () => {
  it('reconciles every available event metric for each day and the complete range', async () => {
    // Expected values are hand-calculated from the source manifest, not computed by production helpers.
    const expected = [
      {
        dateRange: { from: D1, to: D1 },
        people: [2, 2],
        tags: [3, 1, 2, 1, 2],
        messages: [1, 3, 2],
      },
      {
        dateRange: { from: D2, to: D2 },
        people: [1, 1],
        tags: [1, 2, -1, 1, 2],
        messages: [1, 3, 2],
      },
      { dateRange: range, people: [3, 3], tags: [4, 3, 1, 1, 4], messages: [2, 6, 4] },
    ];
    for (const e of expected) {
      for (const [metrics, counts, origins] of [
        [people, e.people, ['channel', 'manual', 'import']],
        [tags, e.tags, ['manual', 'rule']],
        [messages, e.messages, ['channel']],
      ] as const) {
        const r = await ask([...metrics], { dateRange: e.dateRange, origins });
        expect(metrics.map((m) => value(r, m))).toEqual(counts);
      }
    }
  });

  it('counts snapshots by distinct customers and explicit asOf rather than event date range', async () => {
    const current = await ask(tags);
    expect(current.breakdowns.currentTags).toEqual(
      expect.arrayContaining([
        { tagId: g.tagA, count: 1 },
        { tagId: g.tagB, count: 1 },
      ]),
    );
    expect(current.distinctTotals['tags.current']).toBe(1);
    const past = await ask(['tags.current', 'statuses.current'], { asOf: local(D1, '23:59:59') });
    expect(value(past, 'tags.current')).toBe(3);
    expect(value(past, 'statuses.current')).toBe(3);
    expect(past.breakdowns.statuses).toEqual(
      expect.arrayContaining([
        { statusId: g.statusNew, count: 1 },
        { statusId: g.statusQualified, count: 2 },
      ]),
    );
    const now = await ask(['statuses.current']);
    expect(value(now, 'statuses.current')).toBe(4);
    expect(now.breakdowns.statuses).toEqual(
      expect.arrayContaining([
        { statusId: g.statusNew, count: 2 },
        { statusId: g.statusWon, count: 2 },
      ]),
    );
  });

  it('keeps customer origins and first-phone origins distinct', async () => {
    for (const origin of ['manual', 'channel', 'import']) {
      const r = await ask(people, { origins: [origin] });
      expect(people.map((m) => value(r, m))).toEqual([1, 1]);
    }
    const defaults = await ask(people);
    expect(people.map((m) => value(defaults, m))).toEqual([1, 1]);
  });

  it('attributes event counts to old Sales but current tag/status snapshots to the new owner', async () => {
    const s1 = await ask(people, { origins: ['channel', 'manual', 'import'], salesIds: [g.s1] });
    const s2 = await ask(people, { origins: ['channel', 'manual', 'import'], salesIds: [g.s2] });
    expect(people.map((m) => value(s1, m))).toEqual([2, 2]);
    expect(people.map((m) => value(s2, m))).toEqual([1, 1]);
    const oldTags = await ask(tags, { salesIds: [g.s1] });
    const newTags = await ask(tags, { salesIds: [g.s2] });
    expect(tags.map((m) => value(oldTags, m))).toEqual([4, 3, 1, 0, 4]);
    expect(tags.map((m) => value(newTags, m))).toEqual([0, 0, 0, 1, 0]);
    for (const [sales, status] of [
      [g.s1, g.statusNew],
      [g.s2, g.statusWon],
    ]) {
      const r = await ask(['statuses.current'], { salesIds: [sales] });
      expect(value(r, 'statuses.current')).toBe(2);
      expect(r.breakdowns.statuses).toEqual([{ statusId: status, count: 2 }]);
    }
  });

  it('reconciles page totals and every daily event-series point independently', async () => {
    for (const [page, totals] of [
      [g.p1, [1, 4, 3]],
      [g.p2, [1, 2, 1]],
    ] as const) {
      const r = await ask(messages, { pageIds: [page] });
      expect(messages.map((m) => value(r, m))).toEqual(totals);
    }
    const r = await ask(messages);
    expect(r.series.map((s) => [s.date, ...messages.map((m) => s.values[m])])).toEqual([
      [D1, 1, 3, 2],
      [D2, 1, 3, 2],
    ]);
    const tagRows = (await ask(tags)).breakdowns.tags;
    expect(tagRows).toEqual(
      expect.arrayContaining([
        { tagId: g.tagA, assigned: 3, removed: 3, net: 0 },
        { tagId: g.tagB, assigned: 1, removed: 0, net: 1 },
      ]),
    );
  });

  it('reproduces each nonderived metric in drilldowns with the frozen card watermark', async () => {
    const sets = [
      { metrics: people, origins: ['channel', 'manual', 'import'] },
      { metrics: tags.filter((m) => m !== 'tags.net'), origins: ['manual', 'rule'] },
      { metrics: messages, origins: ['channel'] },
      { metrics: ['statuses.current'] as MetricKey[] },
    ];
    for (const set of sets) {
      const result = await ask(set.metrics, set.origins ? { origins: set.origins } : {});
      for (const metric of set.metrics) {
        const payload = {
          query: query([metric], {
            ...(set.origins ? { origins: set.origins } : {}),
            watermark: result.meta.watermarkId,
          }),
          metric,
          limit: 2,
        };
        const first = await t.call(owner.h, 'POST', '/analytics/drilldown', payload);
        expect(first.statusCode, first.body).toBe(200);
        const response = DrilldownResponse.parse(first.json());
        expect(response.total).toBe(value(result, metric));
        let cursor = response.nextCursor;
        let loaded = response.rows.length;
        while (cursor) {
          const next = await t.call(owner.h, 'POST', '/analytics/drilldown', {
            ...payload,
            cursor,
          });
          expect(next.statusCode, next.body).toBe(200);
          const page = DrilldownResponse.parse(next.json());
          loaded += page.rows.length;
          cursor = page.nextCursor;
        }
        expect(loaded).toBe(response.total);
      }
    }
  });

  it('never converts unavailable source or unsupported filters into a successful zero', async () => {
    for (const body of [
      query(['comments.received']),
      query(['customers.new'], { pageIds: [g.p1] }),
      query(['messages.inbound'], { salesIds: [g.s1] }),
      query(['customers.new'], { dateRange: { from: D2, to: D1 } }),
    ]) {
      const r = await t.call(owner.h, 'POST', '/analytics/query', body);
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json().error.details.issues.length).toBeGreaterThan(0);
    }
    const empty = await ask(messages, { dateRange: { from: '2026-10-17', to: '2026-10-18' } });
    expect(messages.map((m) => value(empty, m))).toEqual([0, 0, 0]);
    expect(empty.series).toHaveLength(2);
    expect(
      value(
        await ask(['statuses.current'], { dateRange: { from: '2026-10-17', to: '2026-10-18' } }),
        'statuses.current',
      ),
    ).toBe(4);
  });

  it('reconciles the separate G-B source ledger and aggregate portfolio arithmetic', async () => {
    const response = await t.call(owner.auth, 'POST', '/workspaces', {
      name: 'Golden Portfolio B',
      industry: 'fashion',
    });
    expect(response.statusCode, response.body).toBe(201);
    const workspaceId = response.json().id as string;
    const business = { ...owner, ownWorkspace: workspaceId, h: owner.in(workspaceId) };
    await seedPortfolioBusiness(t, owner, workspaceId);
    const aPeople = await ask(people, { origins: ['channel', 'manual', 'import'] });
    const bPeople = await ask(people, { origins: ['channel', 'manual', 'import'] }, business);
    const aMessages = await ask(messages);
    const bMessages = await ask(messages, {}, business);
    expect(people.map((m) => value(bPeople, m))).toEqual([5, 2]);
    expect(messages.slice(0, 2).map((m) => value(bMessages, m))).toEqual([3, 7]);
    expect(people.map((m) => value(aPeople, m) + value(bPeople, m))).toEqual([8, 5]);
    expect(messages.slice(0, 2).map((m) => value(aMessages, m) + value(bMessages, m))).toEqual([
      5, 13,
    ]);
    expect(bMessages.series.map((d) => d.values['conversations.opened'])).toEqual([1, 2]);
    expect(
      bMessages.series.map(
        (d, i) =>
          (d.values['conversations.opened'] ?? 0) +
          (aMessages.series[i]?.values['conversations.opened'] ?? 0),
      ),
    ).toEqual([2, 3]);
    const stranger = await t.user('golden-stranger@acceptance.test', 'Golden Stranger');
    const denied = await t.call(
      stranger.in(workspaceId),
      'POST',
      '/analytics/query',
      query(people),
    );
    expect(denied.statusCode, denied.body).toBe(404);
  });

  it('keeps projection replay/rebuild idempotent without creating source events', async () => {
    const projector = t.app.get(ProjectorService);
    const source = await t.owner.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.workspaceId, g.ws));
    const before = await ask(messages);
    await projector.rebuild(g.ws as WorkspaceId);
    const after = await ask(messages);
    expect(messages.map((m) => value(after, m))).toEqual(messages.map((m) => value(before, m)));
    expect(
      (
        await t.owner.db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.workspaceId, g.ws))
      ).length,
    ).toBe(source.length);
  });

  it('attributes a later first-phone update to manual even for a channel-created contact', async () => {
    const response = await t.call(owner.auth, 'POST', '/workspaces', {
      name: 'Golden Phone Variant',
      industry: 'fashion',
    });
    expect(response.statusCode, response.body).toBe(201);
    const ws = response.json().id as string;
    const actor = { ...owner, h: owner.in(ws) };
    const id = crypto.randomUUID();
    await t.owner.db
      .insert(schema.contacts)
      .values({ id, workspaceId: ws, name: 'Golden Phone Source Variant' });
    const basePayload = { workspaceId: ws, contactId: id, actorUserId: owner.userId };
    await t.owner.db.insert(schema.outboxEvents).values([
      {
        workspaceId: ws,
        aggregateType: 'contact',
        aggregateId: id,
        type: 'crm.contact.created.v1',
        payload: {
          ...basePayload,
          occurredAt: local(D1, '09:00:00'),
          sourceId: null,
          origin: 'channel',
          phoneCaptured: false,
          statusId: null,
        },
      },
      {
        workspaceId: ws,
        aggregateType: 'contact',
        aggregateId: id,
        type: 'crm.contact.updated.v1',
        payload: {
          ...basePayload,
          occurredAt: local(D2, '09:00:00'),
          fields: ['phone'],
          phoneCaptured: true,
        },
      },
    ]);
    const manual = await ask(people, { origins: ['manual'] }, actor);
    const channel = await ask(people, { origins: ['channel'] }, actor);
    expect(people.map((m) => value(manual, m))).toEqual([0, 1]);
    expect(people.map((m) => value(channel, m))).toEqual([1, 0]);
  });

  it('paginates over fifty equal-timestamp customers while new arrivals cannot widen a frozen drilldown', async () => {
    const response = await t.call(owner.auth, 'POST', '/workspaces', {
      name: 'Golden Pagination Variant',
      industry: 'fashion',
    });
    expect(response.statusCode, response.body).toBe(201);
    const ws = response.json().id as string;
    const actor = { ...owner, h: owner.in(ws) };
    const append = async (count: number) => {
      const rows = Array.from({ length: count }, () => ({
        id: crypto.randomUUID(),
        workspaceId: ws,
        name: 'Equal Timestamp Source',
      }));
      await t.owner.db.insert(schema.contacts).values(rows);
      await t.owner.db.insert(schema.outboxEvents).values(
        rows.map((c) => ({
          workspaceId: ws,
          aggregateType: 'contact',
          aggregateId: c.id,
          type: 'crm.contact.created.v1',
          payload: {
            workspaceId: ws,
            contactId: c.id,
            actorUserId: owner.userId,
            occurredAt: local(D1, '09:00:00'),
            sourceId: null,
            origin: 'manual',
            phoneCaptured: false,
            statusId: null,
          },
        })),
      );
      return rows.map((r) => r.id);
    };
    const sourceIds = await append(51);
    const card = await ask(['customers.new'], { origins: ['manual'] }, actor);
    expect(value(card, 'customers.new')).toBe(51);
    const request = {
      query: query(['customers.new'], { origins: ['manual'], watermark: card.meta.watermarkId }),
      metric: 'customers.new',
      limit: 50,
    };
    const firstResponse = await t.call(actor.h, 'POST', '/analytics/drilldown', request);
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    const first = DrilldownResponse.parse(firstResponse.json());
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const added = await append(1);
    const secondResponse = await t.call(actor.h, 'POST', '/analytics/drilldown', {
      ...request,
      cursor: first.nextCursor,
    });
    expect(secondResponse.statusCode, secondResponse.body).toBe(200);
    const second = DrilldownResponse.parse(secondResponse.json());
    expect(second.rows).toHaveLength(1);
    expect(second.total).toBe(51);
    expect(second.nextCursor).toBeNull();
    const actualIds = [...first.rows, ...second.rows].map((r) => r.contactId);
    expect(new Set(actualIds).size).toBe(51);
    expect([...actualIds].sort()).toEqual([...sourceIds].sort());
    expect(actualIds).not.toContain(added[0]);
    expect(
      value(await ask(['customers.new'], { origins: ['manual'] }, actor), 'customers.new'),
    ).toBe(52);
  });
});
