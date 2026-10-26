import { describe, expect, it } from 'vitest';

import { splitReply } from '../domain/reply-split.js';

describe('splitReply', () => {
  it('keeps one idea as one bubble', () => {
    expect(splitReply('Dạ giày Oxford giá 450.000đ ạ')).toEqual(['Dạ giày Oxford giá 450.000đ ạ']);
  });
  it('cuts sentences and lines into short bubbles', () => {
    expect(
      splitReply(
        'Dạ em chào anh ạ. Shop có giày Oxford và Loafer!\nAnh cần size nào để em kiểm tra?',
      ),
    ).toEqual([
      'Dạ em chào anh ạ.',
      'Shop có giày Oxford và Loafer!',
      'Anh cần size nào để em kiểm tra?',
    ]);
  });
  it('does not cut prices, abbreviations or list numbers', () => {
    expect(splitReply('Địa chỉ 12 Lê Lợi, Q. 1, TP. HCM. Giá từ 1.250.000đ nhé.')).toEqual([
      'Địa chỉ 12 Lê Lợi, Q. 1, TP. HCM.',
      'Giá từ 1.250.000đ nhé.',
    ]);
    expect(splitReply('1. Oxford 450k\n2. Loafer 390k')).toEqual([
      '1. Oxford 450k',
      '2. Loafer 390k',
    ]);
  });
  it('packs down to the cap without losing text', () => {
    const text = 'A một. B hai. C ba. D bốn. E năm. F sáu.';
    const parts = splitReply(text, 3);
    expect(parts).toHaveLength(3);
    expect(parts.join(' ')).toBe(text);
  });
  it('breaks an over-long sentence on spaces and never returns nothing', () => {
    const long = `${'từ '.repeat(500)}hết`;
    expect(splitReply(long, 4).every((p) => p.length <= 1000)).toBe(true);
    expect(splitReply('   ')).toEqual(['']);
  });
});
