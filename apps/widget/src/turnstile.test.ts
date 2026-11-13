import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeToken } from './turnstile.js';

afterEach(() => {
  delete window.turnstile;
  document.body.innerHTML = '';
});

describe('challengeToken', () => {
  it('renders the challenge with the site key and resolves its token, then cleans up', async () => {
    const remove = vi.fn();
    const render = vi.fn(
      (_el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => {
        queueMicrotask(() => o.callback(`token-for-${o.sitekey}`));
        return 'w1';
      },
    );
    window.turnstile = { render, remove };
    await expect(challengeToken('site-key')).resolves.toBe('token-for-site-key');
    expect(render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ sitekey: 'site-key', appearance: 'interaction-only' }),
    );
    expect(remove).toHaveBeenCalledWith('w1');
    expect(document.querySelector('[data-rapiz-turnstile]')).toBeNull();
  });

  it('resolves null when the challenge fails', async () => {
    window.turnstile = {
      render: (_el, o) => {
        queueMicrotask(() => o['error-callback']?.());
        return 'w2';
      },
      remove: () => undefined,
    };
    await expect(challengeToken('site-key')).resolves.toBeNull();
  });
});
