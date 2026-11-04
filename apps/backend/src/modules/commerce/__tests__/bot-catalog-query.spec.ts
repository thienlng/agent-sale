import { describe, expect, it } from 'vitest';

import { ageRanges, catalogTerms, coversAge, queryAge } from '../domain/bot-catalog-query.js';

describe('catalogTerms', () => {
  it('folds, strips punctuation and splits into terms', () => {
    expect(catalogTerms('Ơ? Thú gỗ, xếp thăng bằng!!')).toEqual([
      'thu',
      'go',
      'xep',
      'thang',
      'bang',
    ]);
  });

  it('removes duplicates and single letters', () => {
    expect(catalogTerms('gỗ GO a go b xếp')).toEqual(['go', 'xep']);
  });

  it('keeps at most 8 terms', () => {
    expect(catalogTerms('aa bb cc dd ee ff gg hh ii jj')).toHaveLength(8);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(catalogTerms(' ?! ')).toEqual([]);
  });
});

describe('queryAge', () => {
  it('reads an age with or without diacritics', () => {
    expect(queryAge('the con 7 tuoi thi hoc khoa nao')).toBe(7);
    expect(queryAge('Bé nhà mình 10 tuổi')).toBe(10);
    expect(queryAge('con 5t học được không')).toBe(5);
    expect(queryAge('cháu 12 học lớp nào')).toBe(12);
  });

  it('ignores numbers that are not ages', () => {
    expect(queryAge('khoá 3 tháng giá bao nhiêu')).toBeNull();
    expect(queryAge('IELTS 6.5 mất bao lâu')).toBeNull();
    expect(queryAge('học 2 buổi một tuần')).toBeNull();
  });
});

describe('ageRanges and coversAge', () => {
  it('reads ranges, open ranges and single ages', () => {
    expect(ageRanges('Khóa học Starters cho bé 6-7 tuổi')).toEqual([[6, 7]]);
    expect(ageRanges('Trẻ từ 8 đến 10 tuổi')).toEqual([[8, 10]]);
    expect(ageRanges('Học viên 16+ tuổi')).toEqual([[16, 99]]);
    expect(ageRanges('trên 18 tuổi')).toEqual([[19, 99]]);
    expect(ageRanges('Bé 4 tuổi')).toEqual([[4, 4]]);
    expect(ageRanges('Người đi làm')).toEqual([]);
  });

  it('says whether the stated ages cover an age', () => {
    expect(coversAge('Starters (6–7 tuổi)', 7)).toBe(true);
    expect(coversAge('Movers 8-9 tuoi', 7)).toBe(false);
    expect(coversAge('Giao tiếp cho người đi làm', 7)).toBeNull();
  });
});
