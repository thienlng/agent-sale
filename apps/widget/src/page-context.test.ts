import { beforeEach, describe, expect, it } from 'vitest';
import { visibleSections } from './page-context.js';

/** jsdom has no layout: each marked element gets the box under `data-box` (top, height). */
function place(el: Element) {
  const [top, height] = (el.getAttribute('data-box') ?? '0,0').split(',').map(Number) as [
    number,
    number,
  ];
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, left: 0, right: 1000, width: 1000, height }) as DOMRect;
}

function page(html: string) {
  document.body.innerHTML = html;
  document.querySelectorAll('[data-box]').forEach(place);
}

describe('visibleSections', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads nothing from a page without marked sections', () => {
    page('<main data-box="0,800"><p>Số điện thoại của tôi 0912 345 678</p></main>');
    expect(visibleSections(document, 1000, 800)).toEqual([]);
  });

  it('lists on-screen sections, children before the section around them, by visible area', () => {
    page(`
      <section data-rapiz-section="hero" data-box="-700,800">Hero</section>
      <section data-rapiz-section="pricing" data-rapiz-context="Bảng giá" data-box="100,1200">
        <div data-rapiz-section="pricing-basic" data-box="150,300">Cơ bản 200k</div>
        <div data-rapiz-section="pricing-smart" data-rapiz-context="Gói Smart 400.000đ/tháng"
          data-box="150,700">Smart</div>
        <div data-rapiz-section="pricing-pro" data-box="900,500">Pro (below the fold)</div>
      </section>`);
    expect(visibleSections(document, 1000, 800)).toEqual([
      { name: 'pricing-smart', text: 'Gói Smart 400.000đ/tháng' },
      { name: 'pricing-basic', text: 'Cơ bản 200k' },
      { name: 'hero', text: 'Hero' },
    ]);
  });

  it('caps names and texts and collapses whitespace', () => {
    page(
      `<div data-rapiz-section="${'s'.repeat(100)}" data-box="0,100">a\n\n   b ${'x'.repeat(500)}</div>`,
    );
    const [section] = visibleSections(document, 1000, 800);
    expect(section?.name).toHaveLength(80);
    expect(section?.text.startsWith('a b x')).toBe(true);
    expect(section?.text).toHaveLength(400);
  });
});
