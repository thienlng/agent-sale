import { describe, expect, it } from 'vitest';

import { safeAppPath } from './safe-app-path';

describe('safeAppPath', () => {
  it('accepts dashboard paths', () => {
    expect(safeAppPath('/app')).toBe('/app');
    expect(safeAppPath('/app/products')).toBe('/app/products');
    expect(safeAppPath('/app/bots/abc')).toBe('/app/bots/abc');
  });

  it('rejects anything that could leave the dashboard', () => {
    for (const to of [
      '/apple',
      '/login',
      'https://evil.test/app',
      '//evil.test',
      '/app/../login',
      '/app/%2e%2e/login',
      '/app//evil.test',
      '/app/products?x=1',
      '/app/products#top',
      '/app/%E0%A4%A',
      '/app\\..\\login',
    ])
      expect(safeAppPath(to), to).toBeNull();
  });
});
