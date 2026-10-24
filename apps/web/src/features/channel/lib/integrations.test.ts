import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import { filterConnections, formatDay, initials, planBotPages } from './integrations';

const BOT_A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const BOT_B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02';
let n = 0;
function page(over: Partial<ChannelConnectionDto>): ChannelConnectionDto {
  n += 1;
  return {
    id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e${String(n).padStart(2, '0')}`,
    provider: 'facebook',
    externalId: `10${n}`,
    name: `Page ${n}`,
    status: 'connected',
    botId: null,
    expiresAt: null,
    createdAt: '2026-10-23T03:00:00.000Z',
    ...over,
  };
}
const fbFree = page({ name: 'Kèn Cờ Nải', externalId: '1294530267087684' });
const fbBotA = page({ botId: BOT_A });
const igBotB = page({ provider: 'instagram', botId: BOT_B });
const fbLost = page({ status: 'disconnected' });
const all = [fbFree, fbBotA, igBotB, fbLost];

describe('filterConnections', () => {
  it('"Tất cả" lists every page', () => {
    expect(filterConnections(all, { category: 'all', query: '' })).toEqual(all);
  });
  it('"Chờ kích hoạt" lists connected pages without a bot only', () => {
    expect(filterConnections(all, { category: 'pending', query: '' })).toEqual([fbFree]);
  });
  it('filters by provider and hides coming-soon platforms', () => {
    expect(filterConnections(all, { category: 'instagram', query: '' })).toEqual([igBotB]);
    expect(filterConnections(all, { category: 'zalo', query: '' })).toEqual([]);
  });
  it('searches by name (case-insensitive) or page id', () => {
    expect(filterConnections(all, { category: 'all', query: 'kèn' })).toEqual([fbFree]);
    expect(filterConnections(all, { category: 'all', query: '12945302' })).toEqual([fbFree]);
  });
  it('bot mode keeps only the pages bound to that bot', () => {
    expect(filterConnections(all, { category: 'all', query: '', botId: BOT_A })).toEqual([fbBotA]);
    expect(filterConnections(all, { category: 'instagram', query: '', botId: BOT_A })).toEqual([]);
  });
});

describe('planBotPages', () => {
  it('binds newly checked pages, unbinds unchecked ones and flags moves from another bot', () => {
    const plan = planBotPages(all, BOT_A, new Set([fbFree.id, igBotB.id]));
    expect(plan.bind).toEqual([fbFree, igBotB]);
    expect(plan.unbind).toEqual([fbBotA]);
    expect(plan.moved).toEqual([igBotB]);
  });
  it('is empty when nothing changed', () => {
    const plan = planBotPages(all, BOT_A, new Set([fbBotA.id]));
    expect(plan).toEqual({ bind: [], unbind: [], moved: [] });
  });
});

describe('formatting', () => {
  it('formats dd/MM/yyyy and initials', () => {
    expect(formatDay(new Date(2026, 9, 3, 12).toISOString())).toBe('03/10/2026');
    expect(initials('Kèn Cờ Nải')).toBe('KN');
    expect(initials('shop')).toBe('SH');
    expect(initials('  ')).toBe('?');
  });
});
