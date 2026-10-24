import { foldVietnamese } from '@agent-sales/shared';

/** Page sizes offered by every training data table. */
export const PAGE_SIZES = [10, 20, 50] as const;

export type Page<T> = {
  /** Rows of the (clamped) current page. */
  items: T[];
  /** 1-based page actually shown: clamped into [1, pages]. */
  page: number;
  pages: number;
  /** Index of the first row of the page in the whole list (for row numbers). */
  offset: number;
};

/** Client-side pagination over an already loaded list. */
export function paginate<T>(list: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, Math.floor(page)), pages);
  const offset = (current - 1) * size;
  return { items: list.slice(offset, offset + size), page: current, pages, offset };
}

/** Accent- and case-insensitive "contains" (same folding as the bot's own search). */
export function matchesText(haystack: string, query: string): boolean {
  const q = foldVietnamese(query.trim());
  return !q || foldVietnamese(haystack).includes(q);
}
