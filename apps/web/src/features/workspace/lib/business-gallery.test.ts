import type { MembershipDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { filterBusinesses, GallerySearch, industriesOf } from './business-gallery';

const NOW = Date.parse('2026-11-04T00:00:00Z');
const DAY = 86_400_000;

function biz(name: string, industry: string, daysAgo: number | null): MembershipDto {
  return {
    workspaceId: crypto.randomUUID(),
    workspaceName: name,
    role: 'owner',
    industry,
    accountId: null,
    accountName: null,
    ...(daysAgo === null ? {} : { createdAt: new Date(NOW - daysAgo * DAY).toISOString() }),
  };
}

const all = [
  biz('Cửa hàng Lan', 'retail', 2),
  biz('Spa Hoa', 'spa', 40),
  biz('Villa Biển', 'hotel', 400),
  biz('Đồ cũ', 'retail', null),
];
const names = (list: MembershipDto[]) => list.map((m) => m.workspaceName);

describe('filterBusinesses', () => {
  it('sorts newest first by default, unknown dates last', () => {
    expect(names(filterBusinesses(all, {}, NOW))).toEqual([
      'Cửa hàng Lan',
      'Spa Hoa',
      'Villa Biển',
      'Đồ cũ',
    ]);
  });

  it('sorts oldest first or by name', () => {
    expect(names(filterBusinesses(all, { sort: 'oldest' }, NOW))[0]).toBe('Villa Biển');
    expect(names(filterBusinesses(all, { sort: 'name' }, NOW))).toEqual([
      'Cửa hàng Lan',
      'Đồ cũ',
      'Spa Hoa',
      'Villa Biển',
    ]);
  });

  it('matches the name without accents or case', () => {
    expect(names(filterBusinesses(all, { q: 'cua HANG' }, NOW))).toEqual(['Cửa hàng Lan']);
    expect(names(filterBusinesses(all, { q: 'do cu' }, NOW))).toEqual(['Đồ cũ']);
  });

  it('filters by industry and by creation time', () => {
    expect(names(filterBusinesses(all, { industry: 'retail' }, NOW))).toEqual([
      'Cửa hàng Lan',
      'Đồ cũ',
    ]);
    expect(names(filterBusinesses(all, { created: '90d' }, NOW))).toEqual([
      'Cửa hàng Lan',
      'Spa Hoa',
    ]);
  });

  it('lists each present industry once', () => {
    expect(industriesOf(all)).toEqual(['hotel', 'retail', 'spa']);
  });

  it('drops unknown values from the URL', () => {
    expect(GallerySearch.parse({ created: '2d', sort: 'x', q: 'a' })).toEqual({
      created: undefined,
      sort: undefined,
      q: 'a',
    });
  });
});
