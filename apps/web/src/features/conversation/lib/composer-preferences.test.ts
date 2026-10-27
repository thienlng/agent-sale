import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('personal composer preferences', () => {
  it('defaults to Enter sending and restores each user independently', async () => {
    const preferences = await import('./composer-preferences');
    expect(preferences.enterToSend('sale-a')).toBe(true);
    preferences.setEnterToSend('sale-a', false);
    vi.resetModules();
    const reloaded = await import('./composer-preferences');
    expect(reloaded.enterToSend('sale-a')).toBe(false);
    expect(reloaded.enterToSend('sale-b')).toBe(true);
  });

  it('handles invalid and unavailable storage without breaking the composer', async () => {
    localStorage.setItem('rapiz.inbox.enter.v1:sale', 'corrupt');
    const preferences = await import('./composer-preferences');
    expect(preferences.enterToSend('sale')).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    expect(() => preferences.setEnterToSend('sale', false)).not.toThrow();
    expect(preferences.enterToSend('sale')).toBe(false);
  });
});
