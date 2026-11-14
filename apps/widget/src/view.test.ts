import { describe, expect, it } from 'vitest';
import { onColor, sameDocument, tint } from './view.js';

describe('onColor', () => {
  it('puts charcoal on light colours', () => {
    expect(onColor('#FF7A45')).toBe('#1F1F1F');
    expect(onColor('#ffffff')).toBe('#1F1F1F');
    expect(onColor('#fc0')).toBe('#1F1F1F');
  });

  it('puts white on dark colours', () => {
    expect(onColor('#1F1F1F')).toBe('#FFFFFF');
    expect(onColor('#1d4ed8')).toBe('#FFFFFF');
    expect(onColor('#000a')).toBe('#FFFFFF');
  });
});

describe('sameDocument', () => {
  const here = 'https://shop.vn/index.html?ref=mail';

  it('reads a fragment of this page, with or without index.html', () => {
    expect(sameDocument('https://shop.vn/#pricing', here)).toBe(true);
    expect(sameDocument('/index.html#pricing', 'https://shop.vn/')).toBe(true);
    expect(sameDocument('#pricing', here)).toBe(true);
  });

  it('reads another page, another site or a bare page as a page to load', () => {
    expect(sameDocument('https://shop.vn/bang-gia/#pricing', here)).toBe(false);
    expect(sameDocument('https://other.vn/#pricing', here)).toBe(false);
    expect(sameDocument('https://shop.vn/', here)).toBe(false);
  });
});

describe('tint', () => {
  it('mixes the colour into white', () => {
    expect(tint('#FF7A45', 0)).toBe('#ffffff');
    expect(tint('#FF7A45', 1)).toBe('#ff7a45');
    expect(tint('#FF7A45', 0.2)).toBe('#ffe4da');
    expect(tint('#000', 0.5)).toBe('#808080');
  });
});
