import { describe, expect, it } from 'vitest';

import { safeAppPath } from './safe-app-path';

describe('safeAppPath', () => {
  it('accepts dashboard paths and returns the normalised path', () => {
    expect(safeAppPath('/app')).toBe('/app');
    expect(safeAppPath('/app/products')).toBe('/app/products');
    expect(safeAppPath('/app/bots/abc')).toBe('/app/bots/abc');
    expect(safeAppPath('/app/%70roducts')).toBe('/app/products');
  });

  it('rejects anything that could leave the dashboard', () => {
    for (const to of [
      '/apple',
      '/login',
      'https://evil.test/app',
      '//evil.test',
      '/app/../x',
      '/app/../login',
      '/app/%2e%2e/x',
      '/app/%2E%2E/x',
      '/app/%2e%2e/login',
      '/app/%252e%252e/login',
      '/app/%25252e%25252e/login',
      '/app/%2525252e%2525252e/login',
      '/app/%2f%2e%2e/login',
      '/app//evil.test',
      '/app?x=1',
      '/app/products?x=1',
      '/app/products#top',
      '/app/products%3Fx=1',
      '/app/%E0%A4%A',
      '/app\\..\\login',
      '/app/%5c..%5clogin',
    ])
      expect(safeAppPath(to), to).toBeNull();
  });
});
