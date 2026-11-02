import {
  AssistantThreadDto,
  CreatedInvitation,
  ScheduleDto,
  ScheduleList,
  SchedulePreview,
  ScheduleRunList,
} from '@agent-sales/contracts';
import { eq, schema } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './support/harness.js';

/**
 * The owner's schedule routes over HTTP on Postgres (T-172, spec §5): each route's happy path,
 * validation, staff 403 and another owner's schedule 404.
 */
let h: Harness;
let lan: TestUser;
let staff: TestUser;
let other: TestUser;

beforeAll(async () => {
  h = await startHarness();
  lan = await h.user('lan@schedules.vn', 'Lan');
  staff = await h.user('mai@schedules.vn', 'Mai');
  other = await h.user('binh@schedules.vn', 'Binh');
  await h.owner.db
    .insert(schema.workspaceEntitlementOverrides)
    .values({ workspaceId: lan.ownWorkspace, key: 'members.max', value: 50, reason: 'test' })
    .onConflictDoNothing();
  const inv = await h.call(lan.h, 'POST', '/invitations', { email: staff.email, role: 'admin' });
  expect(inv.statusCode, inv.body).toBe(201);
  const { token } = CreatedInvitation.parse(inv.json());
  const ok = await h.call(staff.auth, 'POST', '/invitation-links/accept', { token });
  expect(ok.statusCode, ok.body).toBe(200);
});

afterAll(async () => {
  await h?.stop();
});

const draft = (businessId: string, over: Record<string, unknown> = {}) => ({
  name: 'Doanh thu hôm qua',
  businessId,
  template: 'revenue_summary',
  mode: 'report',
  params: { period: 'day', window: 'previous' },
  cadence: { kind: 'daily', at: '08:00' },
  channels: ['in_app'],
  ...over,
});

describe('assistant schedule routes', () => {
  it('creates, lists, edits, pauses, resumes, runs and deletes a schedule', async () => {
    const created = await h.call(lan.h, 'POST', '/assistant/schedules', draft(lan.ownWorkspace));
    expect(created.statusCode, created.body).toBe(201);
    const s = ScheduleDto.parse(created.json());
    expect(s).toMatchObject({ status: 'active', createdBy: 'owner', lastRun: null });
    expect(s.nextRunAt).not.toBeNull();

    const list = ScheduleList.parse((await h.call(lan.h, 'GET', '/assistant/schedules')).json());
    expect(list).toMatchObject({ limit: 10, used: 1, emailAvailable: false });
    expect(list.items.map((x) => x.id)).toEqual([s.id]);

    const edited = await h.call(lan.h, 'PATCH', `/assistant/schedules/${s.id}`, {
      cadence: { kind: 'weekly', days: [1], at: '08:00' },
      params: { period: 'week' },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(ScheduleDto.parse(edited.json())).toMatchObject({
      params: { period: 'week', window: 'previous' },
      cadence: { kind: 'weekly', days: [1], at: '08:00' },
    });

    const paused = await h.call(lan.h, 'POST', `/assistant/schedules/${s.id}/pause`);
    expect(paused.statusCode, paused.body).toBe(200);
    expect(ScheduleDto.parse(paused.json())).toMatchObject({ status: 'paused', nextRunAt: null });
    const resumed = await h.call(lan.h, 'POST', `/assistant/schedules/${s.id}/resume`);
    expect(ScheduleDto.parse(resumed.json()).status).toBe('active');

    const run = await h.call(lan.h, 'POST', `/assistant/schedules/${s.id}/run`);
    expect(run.statusCode, run.body).toBe(200);
    const again = await h.call(lan.h, 'POST', `/assistant/schedules/${s.id}/run`);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { details: { reason: 'run_too_soon' } } });

    const removed = await h.call(lan.h, 'DELETE', `/assistant/schedules/${s.id}`);
    expect(removed.statusCode).toBe(204);
    expect((await h.call(lan.h, 'DELETE', `/assistant/schedules/${s.id}`)).statusCode).toBe(404);
  });

  it('previews a draft', async () => {
    const res = await h.call(
      lan.h,
      'POST',
      '/assistant/schedules/preview',
      draft(lan.ownWorkspace),
    );
    expect(res.statusCode, res.body).toBe(200);
    const preview = SchedulePreview.parse(res.json());
    expect(preview.title).toContain('Doanh thu hôm qua');
    expect(preview.body).toContain('0 ₫');
    expect(preview.nextRuns).toHaveLength(3);
  });

  it('lists runs and opens the thread of a run once', async () => {
    const s = ScheduleDto.parse(
      (await h.call(lan.h, 'POST', '/assistant/schedules', draft(lan.ownWorkspace))).json(),
    );
    const [ws] = await h.owner.db
      .select({ accountId: schema.workspaces.accountId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, lan.ownWorkspace));
    const runId = newId();
    await h.owner.db.insert(schema.assistantScheduleRuns).values({
      id: runId,
      accountId: ws!.accountId!,
      ownerUserId: lan.userId,
      scheduleId: s.id,
      trigger: 'cadence',
      scheduledFor: new Date('2026-11-02T01:00:00Z'),
      status: 'done',
      title: 'Doanh thu hôm qua',
      body: 'Doanh thu: 1.250.000 ₫',
      finishedAt: new Date(),
    });
    const runs = await h.call(lan.h, 'GET', `/assistant/schedules/${s.id}/runs?limit=5`);
    expect(runs.statusCode, runs.body).toBe(200);
    expect(ScheduleRunList.parse(runs.json()).items.map((r) => r.id)).toEqual([runId]);
    expect(
      (await h.call(lan.h, 'GET', `/assistant/schedules/${s.id}/runs?limit=99`)).statusCode,
    ).toBe(400);

    const t1 = await h.call(lan.h, 'POST', `/assistant/schedule-runs/${runId}/thread`);
    expect(t1.statusCode, t1.body).toBe(200);
    const thread = AssistantThreadDto.parse(t1.json());
    const t2 = AssistantThreadDto.parse(
      (await h.call(lan.h, 'POST', `/assistant/schedule-runs/${runId}/thread`)).json(),
    );
    expect(t2.id).toBe(thread.id);
    const messages = await h.call(lan.h, 'GET', `/assistant/threads/${thread.id}/messages`);
    expect(JSON.stringify(messages.json())).toContain('1.250.000 ₫');

    // Another owner sees neither the runs nor the thread.
    expect((await h.call(other.h, 'GET', `/assistant/schedules/${s.id}/runs`)).statusCode).toBe(
      404,
    );
    expect(
      (await h.call(other.h, 'POST', `/assistant/schedule-runs/${runId}/thread`)).statusCode,
    ).toBe(404);
  });

  it('answers 400 on an invalid draft and for a business outside the scope', async () => {
    const bad = await h.call(lan.h, 'POST', '/assistant/schedules', {
      ...draft(lan.ownWorkspace),
      cadence: { kind: 'daily', at: '25:00' },
    });
    expect(bad.statusCode).toBe(400);
    const alert = await h.call(
      lan.h,
      'POST',
      '/assistant/schedules',
      draft(lan.ownWorkspace, { mode: 'alert' }),
    );
    expect(alert.statusCode).toBe(400);
    expect(alert.json()).toMatchObject({ error: { details: { reason: 'invalid_mode' } } });
    const foreign = await h.call(lan.h, 'POST', '/assistant/schedules', draft(other.ownWorkspace));
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json()).toMatchObject({ error: { details: { reason: 'unknown_business' } } });
    const email = await h.call(
      lan.h,
      'POST',
      '/assistant/schedules',
      draft(lan.ownWorkspace, { channels: ['in_app', 'email'] }),
    );
    expect(email.json()).toMatchObject({ error: { details: { reason: 'email_unavailable' } } });
    const s = ScheduleDto.parse(
      (await h.call(lan.h, 'POST', '/assistant/schedules', draft(lan.ownWorkspace))).json(),
    );
    expect((await h.call(lan.h, 'PATCH', `/assistant/schedules/${s.id}`, {})).statusCode).toBe(400);
  });

  it('refuses staff (403) and hides another owner’s schedule (404)', async () => {
    const s = ScheduleDto.parse(
      (await h.call(lan.h, 'POST', '/assistant/schedules', draft(lan.ownWorkspace))).json(),
    );
    const asStaff = staff.in(lan.ownWorkspace);
    const calls: [string, string, object?][] = [
      ['GET', '/assistant/schedules'],
      ['POST', '/assistant/schedules', draft(lan.ownWorkspace)],
      ['POST', '/assistant/schedules/preview', draft(lan.ownWorkspace)],
      ['PATCH', `/assistant/schedules/${s.id}`, { name: 'x' }],
      ['POST', `/assistant/schedules/${s.id}/pause`],
      ['POST', `/assistant/schedules/${s.id}/resume`],
      ['POST', `/assistant/schedules/${s.id}/run`],
      ['DELETE', `/assistant/schedules/${s.id}`],
      ['GET', `/assistant/schedules/${s.id}/runs`],
      ['POST', `/assistant/schedule-runs/${newId()}/thread`],
    ];
    for (const [method, url, body] of calls) {
      const res = await h.call(asStaff, method as 'GET', url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    for (const [method, url] of [
      ['PATCH', `/assistant/schedules/${s.id}`],
      ['POST', `/assistant/schedules/${s.id}/pause`],
      ['POST', `/assistant/schedules/${s.id}/resume`],
      ['POST', `/assistant/schedules/${s.id}/run`],
      ['DELETE', `/assistant/schedules/${s.id}`],
    ] as const) {
      const res = await h.call(
        other.h,
        method,
        url,
        method === 'PATCH' ? { name: 'x' } : undefined,
      );
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const mine = ScheduleList.parse((await h.call(other.h, 'GET', '/assistant/schedules')).json());
    expect(mine.items).toEqual([]);
  });
});
