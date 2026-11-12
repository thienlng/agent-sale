import { describe, expect, it, vi } from 'vitest';

// A lazy catalog chunk (`integration`, `brain`) fails to load (offline, a stale deploy).
vi.mock('@/lib/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadNamespace: vi.fn(() => Promise.reject(new Error('chunk load failed'))),
}));

const { Route: contactsRoute } = await import('../contacts');
const { Route: inboxRoute } = await import('../inbox');
const { Route: analyticsRoute } = await import('../analytics');

describe('routes that borrow a lazy namespace', () => {
  it.each([
    ['/app/contacts', contactsRoute],
    ['/app/inbox', inboxRoute],
    ['/app/analytics', analyticsRoute],
  ])(
    '%s still opens when the namespace fails to load (raw keys, no error page)',
    async (_, route) => {
      const loader = route.options.loader as unknown as () => Promise<unknown>;
      await expect(loader()).resolves.toBeUndefined();
    },
  );
});
