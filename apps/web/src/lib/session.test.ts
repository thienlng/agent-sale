import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api, getWorkspaceId } from './api-client';
import {
  getSession,
  login,
  logout,
  onSessionExpired,
  onWorkspaceLost,
  selectWorkspace,
  syncMembership,
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
const both = [
  { workspaceId: A, workspaceName: 'Business A', role: 'owner' },
  { workspaceId: B, workspaceName: 'Business B', role: 'sales' },
];
let memberships = both;
const lost = {
  error: {
    code: 'NOT_FOUND',
    message: 'Workspace not found',
    details: { reason: 'workspace_access' },
  },
};
async function authenticate(remembered?: string, list = both) {
  localStorage.clear();
  if (remembered) localStorage.setItem('rapiz.workspace', remembered);
  memberships = list;
  vi.stubGlobal('fetch', async (input: string) =>
    input.endsWith('/bootstrap')
      ? new Response(JSON.stringify({ user, memberships }))
      : input.endsWith('/members')
        ? new Response(JSON.stringify(lost), { status: 404 })
        : new Response(JSON.stringify({ user, accessToken: 'test-token', expiresIn: 900 })),
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
    expect(getWorkspaceId()).toBe(null);
  });
  it('asks the user to choose when they have several businesses and none remembered', async () => {
    await authenticate();
    expect(getSession()?.workspaceId).toBeNull();
    await authenticate(B);
    expect(getSession()?.workspaceId).toBe(B);
    await authenticate('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d99');
    expect(getSession()?.workspaceId).toBeNull();
    await authenticate(undefined, [both[1]!]);
    expect(getSession()?.workspaceId).toBe(B);
  });
  it('reloads the session and reports a lost current business once', async () => {
    await authenticate(A);
    const handler = vi.fn();
    onWorkspaceLost(handler);
    memberships = [both[1]!];
    await Promise.allSettled([api('/members', z.unknown()), api('/members', z.unknown())]);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(getSession()?.memberships).toHaveLength(1);
    expect(getSession()?.workspaceId).toBe(B);
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
