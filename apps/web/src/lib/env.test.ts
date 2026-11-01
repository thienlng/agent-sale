import { afterEach, describe, expect, it, vi } from 'vitest';

import { widgetUrl } from './env';

describe('widgetUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('makes a configured path absolute on the dashboard origin', () => {
    vi.stubEnv('VITE_WIDGET_URL', '/widget.js');
    expect(widgetUrl()).toBe(`${location.origin}/widget.js`);
  });

  it('keeps a configured absolute URL', () => {
    vi.stubEnv('VITE_WIDGET_URL', 'https://widget.example.com/v1/widget.js');
    expect(widgetUrl()).toBe('https://widget.example.com/v1/widget.js');
  });
});
