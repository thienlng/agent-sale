import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath', () => {
  it('keeps same-app paths', () => {
    expect(safeRedirectPath('/app/inbox')).toBe('/app/inbox');
    expect(safeRedirectPath('/app/inbox?x=1#top')).toBe('/app/inbox?x=1#top');
  });

  it('falls back for anything that could leave the app', () => {
    for (const target of [
      undefined,
      null,
      '',
      'app/inbox',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/app\\..\\evil',
      '/\t/evil.example',
      '/\n/evil.example',
      '/app/\r\nx',
      '/app/\u0000',
      '/ /evil.example',
      '/app/\u007f',
    ])
      expect(safeRedirectPath(target), JSON.stringify(target)).toBe('/app/analytics');
  });
});
