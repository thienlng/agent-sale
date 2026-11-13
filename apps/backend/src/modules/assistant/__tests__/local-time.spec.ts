import type { RunnableTool } from '@agent-sales/ai-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { withLocalTimes } from '../application/local-time-tools.js';
import {
  describeNow,
  localizeInstantsInJson,
  toLocalInstant,
  toUtcInstant,
  utcInstants,
} from '../domain/local-time.js';

describe('the owner clock (AS-3)', () => {
  it('writes a UTC instant on the Asia/Ho_Chi_Minh clock, across midnight', () => {
    expect(toLocalInstant('2026-11-12T20:05:39.000Z')).toBe('2026-11-13T03:05:39+07:00');
    expect(toLocalInstant('2026-11-12T20:05Z')).toBe('2026-11-13T03:05:00+07:00');
    expect(toLocalInstant('2026-11-12T20:05:39+00:00')).toBe('2026-11-13T03:05:39+07:00');
  });

  it('leaves dates, local instants and text alone', () => {
    for (const text of ['2026-12-19', '2026-11-13T03:05:39+07:00', 'BK-0012', 'Z']) {
      expect(toLocalInstant(text)).toBe(text);
    }
  });

  it('localizes every instant value of a JSON tool result, cut or not', () => {
    const body = JSON.stringify({
      status: 200,
      body: {
        items: [
          { code: 'BK-0012', holdExpiresAt: '2026-11-12T20:05:39.000Z', checkIn: '2027-01-15' },
        ],
      },
    });
    const out = localizeInstantsInJson(body);
    expect(out).toContain('"holdExpiresAt":"2026-11-13T03:05:39+07:00"');
    expect(out).toContain('"checkIn":"2027-01-15"');
    expect(
      localizeInstantsInJson('{"a":"2026-11-12T20:05:39.000Z","b":"2026-11-1…[truncated]'),
    ).toBe('{"a":"2026-11-13T03:05:39+07:00","b":"2026-11-1…[truncated]');
  });

  it('turns the local instants the model writes back into UTC for the routes', () => {
    expect(toUtcInstant('2026-11-13T03:05:39+07:00')).toBe('2026-11-12T20:05:39.000Z');
    expect(toUtcInstant('2026-11-12T20:05:39.000Z')).toBe('2026-11-12T20:05:39.000Z');
    expect(utcInstants({ from: '2026-11-16T00:00:00+07:00', note: 'giữ chỗ', n: 2 })).toEqual({
      from: '2026-11-15T17:00:00.000Z',
      note: 'giữ chỗ',
      n: 2,
    });
  });

  it('wraps every tool so its result reads on the owner clock', async () => {
    const tool: RunnableTool = {
      name: 'tool_call',
      readOnly: true,
      schema: z.unknown(),
      run: () => Promise.resolve({ content: '{"at":"2026-11-12T20:05:39.000Z"}', ok: true }),
    };
    const [wrapped] = withLocalTimes([tool]);
    expect(await wrapped!.run({})).toEqual({
      content: '{"at":"2026-11-13T03:05:39+07:00"}',
      ok: true,
    });
  });
});

describe('describeNow (AS-4)', () => {
  it('gives the date, weekday and the week and month ranges on the owner clock', () => {
    // 01:08 on Friday 13 November in Vietnam is still the 12th in UTC.
    expect(describeNow(new Date('2026-11-12T18:08:00.000Z'))).toBe(
      '2026-11-13 01:08 Friday (Asia/Ho_Chi_Minh, +07:00); this week 2026-11-09..2026-11-15; ' +
        'next week 2026-11-16..2026-11-22; this month 2026-11-01..2026-11-30',
    );
  });

  it('starts the week on Monday, also on a Sunday and across a month end', () => {
    expect(describeNow(new Date('2026-11-29T05:00:00.000Z'))).toBe(
      '2026-11-29 12:00 Sunday (Asia/Ho_Chi_Minh, +07:00); this week 2026-11-23..2026-11-29; ' +
        'next week 2026-11-30..2026-12-06; this month 2026-11-01..2026-11-30',
    );
  });
});
