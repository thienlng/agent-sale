import { afterEach, describe, expect, it, vi } from 'vitest';

import { getWorkspaceId } from './api-client';
import {
  getSession,
  login,
  logout,
  onSessionExpired,
  renameMembership,
  selectWorkspace,
} from './session';

const A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22';
const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'demo@example.test',
  name: 'Demo',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: false,
};
async function authenticate() {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    async (input: string) =>
      new Response(
        JSON.stringify(
          input.endsWith('/bootstrap')
            ? {
                user,
                memberships: [
                  { workspaceId: A, workspaceName: 'Business A', role: 'owner' },
                  { workspaceId: B, workspaceName: 'Business B', role: 'sales' },
                ],
              }
            : { user, accessToken: 'test-token', expiresIn: 900 },
        ),
      ),
  );
  await login({ email: user.email, password: 'test' });
}
afterEach(() => vi.unstubAllGlobals());
describe('business selection', () => {
  it('does not let a delayed remote logout delete a newer session hint or private draft', async () => {
    await authenticate();
    localStorage.setItem('rapiz.session', '1');
    localStorage.setItem('rapiz.private-generation', 'newer-generation');
    localStorage.setItem('rapiz.private.inbox.draft.v1:fresh', 'Fresh session draft');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'rapiz.session', oldValue: '1', newValue: null }),
    );
    expect(getSession()).toBeNull();
    expect(localStorage.getItem('rapiz.session')).toBe('1');
    expect(localStorage.getItem('rapiz.private.inbox.draft.v1:fresh')).toBe('Fresh session draft');
    expect(localStorage.getItem('rapiz.private-generation')).toBe('newer-generation');
  });

  it('terminates the local session when another tab logs out', async () => {
    await authenticate();
    const expired = vi.fn();
    onSessionExpired(expired);
    window.dispatchEvent(new StorageEvent('storage', { key: 'rapiz.session', newValue: null }));
    expect(getSession()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it('updates the shared API context only to a session membership and remembers it', async () => {
    await authenticate();
    expect(selectWorkspace(B)).toBe(true);
    expect(getSession()?.workspaceId).toBe(B);
    expect(getWorkspaceId()).toBe(B);
    expect(localStorage.getItem('rapiz.workspace')).toBe(B);
    expect(getSession()?.memberships.find((m) => m.workspaceId === B)?.role).toBe('sales');
  });
  it('rejects an arbitrary business without changing the session, role, or API scope', async () => {
    await authenticate();
    const previous = getSession();
    expect(selectWorkspace('not-a-membership')).toBe(false);
    expect(getSession()).toBe(previous);
    expect(getWorkspaceId()).toBe(A);
  });

  it('clears private feature storage even when logout fails and the feature was not loaded', async () => {
    await authenticate();
    localStorage.setItem('rapiz.private.inbox.draft.v1:example', 'Unsent synthetic text');
    localStorage.setItem('rapiz.locale', 'vi');
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    await expect(logout()).rejects.toThrow();
    expect(getSession()).toBeNull();
    expect(localStorage.getItem('rapiz.private.inbox.draft.v1:example')).toBeNull();
    expect(localStorage.getItem('rapiz.locale')).toBe('vi');
  });
});
describe('renameMembership', () => {
  it('shows a saved business name in the memberships without touching the others', async () => {
    await authenticate();
    renameMembership(A, 'Shop Hoa');
    const names = getSession()?.memberships.map((m) => m.workspaceName);
    expect(names).toEqual(['Shop Hoa', 'Business B']);
    expect(getSession()?.workspaceId).toBe(A);
  });
});
