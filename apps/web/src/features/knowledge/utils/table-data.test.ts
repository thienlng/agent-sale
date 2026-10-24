import { describe, expect, it } from 'vitest';

import { matchesText, paginate } from './table-data';

describe('paginate', () => {
  const list = Array.from({ length: 23 }, (_, i) => i + 1);

  it('slices the requested page and reports the offset', () => {
    expect(paginate(list, 2, 10)).toEqual({
      items: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      page: 2,
      pages: 3,
      offset: 10,
    });
  });

  it('clamps a page past the end (e.g. after a search shrinks the list)', () => {
    const page = paginate(list, 9, 10);
    expect(page.page).toBe(3);
    expect(page.items).toEqual([21, 22, 23]);
  });

  it('keeps one empty page for an empty list', () => {
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, pages: 1, offset: 0 });
  });
});

describe('matchesText', () => {
  it('ignores accents and case', () => {
    expect(matchesText('Phí ship nội thành', 'phi SHIP')).toBe(true);
    expect(matchesText('Đổi trả', 'doi tra')).toBe(true);
  });

  it('treats a blank query as a match', () => {
    expect(matchesText('anything', '   ')).toBe(true);
  });

  it('rejects text that does not contain the query', () => {
    expect(matchesText('Giờ mở cửa', 'ship')).toBe(false);
  });
});
