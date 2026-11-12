import type { MembershipDto } from '@agent-sales/contracts';
import { z } from 'zod';

export const CREATED_WITHIN = ['7d', '30d', '90d', '365d'] as const;
export const GALLERY_SORTS = ['newest', 'oldest', 'name'] as const;

/** Gallery filters live in the URL so a view survives a reload and can be shared. */
export const GallerySearch = z.object({
  q: z.string().max(100).optional().catch(undefined),
  industry: z.string().max(64).optional().catch(undefined),
  created: z.enum(CREATED_WITHIN).optional().catch(undefined),
  sort: z.enum(GALLERY_SORTS).optional().catch(undefined),
});
export type GallerySearch = z.infer<typeof GallerySearch>;

const DAY_MS = 86_400_000;
const DAYS: Record<(typeof CREATED_WITHIN)[number], number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

/** Accent- and case-insensitive, so "cua hang" finds "Cửa hàng". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function createdMs(m: MembershipDto): number | null {
  const ms = m.createdAt ? Date.parse(m.createdAt) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The businesses the gallery shows for the given filters. A business without a known creation
 * time never matches a "created within" filter and sorts last by date.
 */
export function filterBusinesses(
  businesses: readonly MembershipDto[],
  search: GallerySearch,
  now: number = Date.now(),
): MembershipDto[] {
  const q = fold(search.q ?? '');
  const since = search.created ? now - DAYS[search.created] * DAY_MS : null;
  const out = businesses.filter((m) => {
    if (q && !fold(m.workspaceName).includes(q)) return false;
    if (search.industry && m.industry !== search.industry) return false;
    if (since !== null) {
      const at = createdMs(m);
      if (at === null || at < since) return false;
    }
    return true;
  });
  const sort = search.sort ?? 'newest';
  if (sort === 'name')
    return out.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName, 'vi'));
  const sign = sort === 'newest' ? -1 : 1;
  return out.sort((a, b) => {
    const x = createdMs(a);
    const y = createdMs(b);
    if (x === y) return a.workspaceName.localeCompare(b.workspaceName, 'vi');
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y);
  });
}

/** Whole days left to restore a deleted business, rounded up (0 once the window ended). */
export function restoreDaysLeft(purgeAfter: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(purgeAfter) - now) / DAY_MS));
}

/** Industries present among the businesses, for the filter's options. */
export function industriesOf(businesses: readonly MembershipDto[]): string[] {
  return [...new Set(businesses.map((m) => m.industry).filter(Boolean))].sort();
}
