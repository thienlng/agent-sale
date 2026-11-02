import { isNotFound, isRedirect } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Route } from '@/routes/admin';
import { Route as AdminIndex } from '@/routes/admin/index';

const session = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/session', () => ({ ensureSession: () => Promise.resolve(session.value) }));
beforeEach(() => {
  session.value = null;
});

const user = (isPlatformAdmin: boolean) => ({ user: { id: 'u-1', isPlatformAdmin } });
async function guard(): Promise<unknown> {
  const beforeLoad = Route.options.beforeLoad as (ctx: unknown) => Promise<void>;
  try {
    await beforeLoad({ location: { href: '/admin/accounts' } });
    return 'allowed';
  } catch (thrown) {
    return thrown;
  }
}

describe('/admin guard', () => {
  it('sends a signed-out visitor to the login page', async () => {
    expect(isRedirect(await guard())).toBe(true);
  });

  it('answers a plain 404 to a signed-in non-admin', async () => {
    session.value = user(false);
    expect(isNotFound(await guard())).toBe(true);
  });

  it('lets a platform admin in, and /admin opens the accounts list', () => {
    session.value = user(true);
    return guard().then((result) => {
      expect(result).toBe('allowed');
      let target: unknown;
      try {
        (AdminIndex.options.beforeLoad as () => void)();
      } catch (thrown) {
        target = thrown;
      }
      expect(isRedirect(target)).toBe(true);
      expect((target as { options: { to: string } }).options.to).toBe('/admin/accounts');
    });
  });
});
