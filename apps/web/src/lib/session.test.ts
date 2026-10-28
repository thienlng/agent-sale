import { afterEach, describe, expect, it, vi } from 'vitest';

import { getWorkspaceId } from './api-client';
import { getSession, login, syncMembership, selectWorkspace } from './session';

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
});
describe('syncMembership', () => {
  it('shows a saved name and logo in the memberships without touching the others', async () => {
    await authenticate();
    syncMembership(A, { name: 'Shop Hoa', logoVersion: 'abc123', icon: 'store' });
    const rows = getSession()?.memberships;
    expect(rows?.map((m) => m.workspaceName)).toEqual(['Shop Hoa', 'Business B']);
    expect(rows?.map((m) => m.logoVersion ?? null)).toEqual(['abc123', null]);
    expect(getSession()?.workspaceId).toBe(A);
  });
});
