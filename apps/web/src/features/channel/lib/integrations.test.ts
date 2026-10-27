import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import {
  BOT_PLATFORMS,
  filterConnections,
  formatDay,
  initials,
  isComingSoon,
  planBotPages,
  WORKSPACE_PLATFORMS,
} from './integrations';

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
  it('"Chờ kích hoạt" lists unassigned pages regardless of connectivity', () => {
    expect(filterConnections(all, { category: 'pending', query: '' })).toEqual([fbFree, fbLost]);
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

it('filters all pages by assigned bot or explicitly unassigned, independently of connection state', () => {
  expect(filterConnections(all, { category: 'all', query: '', assignedBotId: BOT_A })).toEqual([
    fbBotA,
  ]);
  expect(filterConnections(all, { category: 'all', query: '', assignedBotId: null })).toEqual([
    fbFree,
    fbLost,
  ]);
  expect(
    filterConnections(all, { category: 'instagram', query: '', assignedBotId: BOT_A }),
  ).toEqual([]);
});

describe('website platform', () => {
  const site = page({ provider: 'website', externalId: 'wk_abc', name: 'Shop web' });
  it('is listed and enabled on both screens and no longer coming soon', () => {
    for (const list of [WORKSPACE_PLATFORMS, BOT_PLATFORMS]) {
      expect(list.find((p) => p.key === 'website')).toEqual({ key: 'website' });
    }
    expect(isComingSoon('website')).toBe(false);
  });
  it('filters websites by provider and keeps them out of Facebook', () => {
    const mixed = [fbFree, site];
    expect(filterConnections(mixed, { category: 'website', query: '' })).toEqual([site]);
    expect(filterConnections(mixed, { category: 'facebook', query: '' })).toEqual([fbFree]);
    expect(filterConnections(mixed, { category: 'all', query: 'wk_' })).toEqual([site]);
  });
});
