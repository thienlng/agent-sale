import { describe, expect, it } from 'vitest';

import { normalizeReplyText, quotedSources } from '../domain/reply-text.js';

describe('normalizeReplyText: literal "\\n" in the customer reply (T-135)', () => {
  it('turns every stand-alone literal \\n into a line break, wherever the model put it', () => {
    expect(normalizeReplyText('Dạ shop còn mẫu này ạ.\\nAnh/chị đi size bao nhiêu ạ?')).toBe(
      'Dạ shop còn mẫu này ạ.\nAnh/chị đi size bao nhiêu ạ?',
    );
    // Vietnamese replies often end a line with "ạ", an emoji or a lowercase start.
    expect(normalizeReplyText('Dạ còn ạ\\nanh/chị cần size nào ạ')).toBe(
      'Dạ còn ạ\nanh/chị cần size nào ạ',
    );
    expect(normalizeReplyText('Dạ em chào anh 😊\\n\\nShop có ạ')).toBe(
      'Dạ em chào anh 😊\n\nShop có ạ',
    );
    expect(normalizeReplyText('Dạ\\r\\nVâng ạ')).toBe('Dạ\nVâng ạ');
  });

  it('still converts when the reply quotes a product name', () => {
    expect(normalizeReplyText('Dạ mẫu "Áo thun basic" còn ạ.\\nAnh/chị lấy màu gì ạ?')).toBe(
      'Dạ mẫu "Áo thun basic" còn ạ.\nAnh/chị lấy màu gì ạ?',
    );
  });

  it('keeps real line breaks and an escaped backslash before n, and trims the ends', () => {
    expect(normalizeReplyText('  Dòng một\nDòng hai \n')).toBe('Dòng một\nDòng hai');
    expect(normalizeReplyText(String.raw`Ký hiệu \\n giữ nguyên`)).toBe(
      String.raw`Ký hiệu \\n giữ nguyên`,
    );
  });

  it('converts after a one-letter label and inside backticks too: a sales reply has no code', () => {
    expect(normalizeReplyText('Mẫu A:\\n- giá 100k\\nMẫu B:\\n- giá 200k')).toBe(
      'Mẫu A:\n- giá 100k\nMẫu B:\n- giá 200k',
    );
    expect(normalizeReplyText('Mã `SP01` còn ạ\\nAnh lấy mấy cái ạ?')).toBe(
      'Mã `SP01` còn ạ\nAnh lấy mấy cái ạ?',
    );
  });

  it('stays linear on long input', () => {
    const reply = `${'\\n'.repeat(5_000)}x`;
    const started = performance.now();
    expect(normalizeReplyText(reply)).toBe('x');
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('quotedSources', () => {
  const sources = [
    { key: 'kb:1', answer: 'Dạ áo thun giá 350.000đ, hotline 0901234567' },
    { key: 'kb:2', answer: 'Giao hàng toàn quốc trong 2 đến 4 ngày làm việc ạ' },
    { key: 'kb:3', answer: 'Bảo hành 6 tháng' },
  ];

  it('marks an entry the reply quotes, ignoring accents and punctuation', () => {
    expect(quotedSources('Dạ ao thun gia 350.000đ, hotline 0901234567 ạ', sources)).toEqual(
      new Set(['kb:1']),
    );
  });

  it('accepts a run of six words of a long answer, or the whole of a short one', () => {
    const used = quotedSources(
      'Bên em giao hàng toàn quốc trong 2 đến 4 ngày; bảo hành 6 tháng ạ',
      sources,
    );
    expect(used).toEqual(new Set(['kb:2', 'kb:3']));
  });

  it('marks nothing for an unrelated reply', () => {
    expect(quotedSources('Dạ em chào anh ạ', sources).size).toBe(0);
  });
});
