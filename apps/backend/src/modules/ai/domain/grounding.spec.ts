import { describe, expect, it } from 'vitest';

import { knowledgeBlock, toSources, ungroundedFigures } from './grounding.js';

describe('toSources', () => {
  it('fills placeholders and drops entries that still have unfilled ones', () => {
    const sources = toSources(
      [
        { id: 'a', question: 'Shop ở đâu?', answer: 'Dạ ở {{store.address}}', score: 0.9 },
        { id: 'b', question: 'Mấy giờ mở cửa?', answer: 'Dạ {{store.hours}}', score: 0.5 },
      ],
      { 'store.address': '12 Lê Lợi' },
    );
    expect(sources).toEqual([
      { key: 'kb:1', faqId: 'a', question: 'Shop ở đâu?', answer: 'Dạ ở 12 Lê Lợi', score: 0.9 },
    ]);
    expect(knowledgeBlock(sources)).toContain('[kb:1]\nQ: Shop ở đâu?\nA: Dạ ở 12 Lê Lợi');
  });

  it('numbers the remaining sources without gaps', () => {
    const sources = toSources(
      [
        { id: 'a', question: 'q1?', answer: '{{x}}', score: 1 },
        { id: 'b', question: 'q2?', answer: 'ok', score: 1 },
      ],
      {},
    );
    expect(sources.map((s) => s.key)).toEqual(['kb:1']);
  });
});

describe('ungroundedFigures', () => {
  const trusted = ['Áo thun giá 350.000đ, phí ship 30k, hotline 0901 234 567'];

  it('accepts figures written differently from the source', () => {
    expect(ungroundedFigures('Dạ áo giá 350k, ship 30.000đ ạ', trusted)).toEqual([]);
    expect(ungroundedFigures('Dạ áo giá 350 nghìn ạ', trusted)).toEqual([]);
  });

  it('flags a price, fee or delay that is not in any trusted text', () => {
    expect(ungroundedFigures('Dạ áo giá 299k, giao trong 2 ngày ạ', trusted)).toEqual([
      '299k',
      '2',
    ]);
  });

  it('lets the customer vouch for sizes and quantities, never for money', () => {
    expect(ungroundedFigures('Dạ size 42 còn ạ', trusted, ['còn size 42 không'])).toEqual([]);
    expect(ungroundedFigures('Dạ giá 1k đúng ạ', trusted, ['giá 1k đúng không shop'])).toEqual([
      '1k',
    ]);
    expect(ungroundedFigures('Dạ 99.000đ ạ', trusted, ['99.000đ được không'])).toEqual(['99.000d']);
  });

  it('never lets a bare number vouch for an amount with a unit', () => {
    expect(ungroundedFigures('Dạ giá 42k ạ', ['size 42'])).toEqual(['42k']);
    expect(ungroundedFigures('Dạ giá 350 triệu ạ', ['giá 350k, size 42'])).toEqual(['350 trieu']);
  });

  it('replies without figures are always grounded', () => {
    expect(ungroundedFigures('Dạ em chào anh/chị ạ', [])).toEqual([]);
  });
});
