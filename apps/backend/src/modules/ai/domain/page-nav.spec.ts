import { describe, expect, it } from 'vitest';
import { navTargets } from './page-nav.js';

const page = (nav: { label: string; url: string }[], url = 'https://shop.vn/san-pham?ref=x') => ({
  url,
  title: 'Sản phẩm',
  sections: [],
  nav,
});

describe('navTargets', () => {
  it('numbers the same-origin sections and pages, without query', () => {
    expect(
      navTargets(
        page([
          { label: 'Bảng giá', url: 'https://shop.vn/san-pham#pricing' },
          { label: 'Liên hệ', url: '/lien-he?utm=1' },
        ]),
      ),
    ).toEqual([
      {
        id: 'n1',
        label: 'Bảng giá',
        url: 'https://shop.vn/san-pham#pricing',
        path: '/san-pham#pricing',
        here: true,
      },
      {
        id: 'n2',
        label: 'Liên hệ',
        url: 'https://shop.vn/lien-he',
        path: '/lien-he',
        here: false,
      },
    ]);
  });

  it('drops other origins, other schemes, the page itself and duplicates', () => {
    const targets = navTargets(
      page([
        { label: 'Evil', url: 'https://evil.test/' },
        { label: 'Mail', url: 'mailto:a@shop.vn' },
        { label: 'Script', url: 'javascript:alert(1)' },
        { label: 'Here', url: '/san-pham' },
        { label: 'Home', url: '/' },
        { label: 'Home again', url: 'https://shop.vn/?a=1' },
      ]),
    );
    expect(targets.map((t) => t.label)).toEqual(['Home']);
  });

  it('is empty without a page, nav or a web page URL', () => {
    expect(navTargets(undefined)).toEqual([]);
    expect(navTargets({ url: 'https://shop.vn/', title: '', sections: [] } as never)).toEqual([]);
    expect(navTargets(page([{ label: 'A', url: '/a' }], 'file:///x'))).toEqual([]);
  });
});
