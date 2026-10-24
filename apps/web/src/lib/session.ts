import {
  AuthResponse,
  BootstrapResponse,
  type LoginRequest,
  type MembershipDto,
  type SignupRequest,
  type UserDto,
} from '@agent-sales/contracts';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import {
  api,
  refreshSession,
  setAccessToken,
  setSessionExpiredHandler,
  setWorkspaceId,
} from './api-client';
import { storage } from './storage';

/**
 * Who is logged in and which workspace they act on. Kept outside React so
 * route guards (beforeLoad) and the API client can read it synchronously.
 */
export interface Session {
  user: UserDto;
  memberships: MembershipDto[];
  workspaceId: string | null;
}

const WORKSPACE_KEY = 'razpi.workspace';
/** Set while this browser holds a session, so a first visit to /login makes no refresh call. */
const SESSION_HINT_KEY = 'razpi.session';

let session: Session | null = null;
let restoring: Promise<Session | null> | null = null;
const listeners = new Set<() => void>();

function set(next: Session | null): void {
  session = next;
  setWorkspaceId(next?.workspaceId ?? null);
  if (next?.workspaceId) storage.set(WORKSPACE_KEY, next.workspaceId);
  if (next) storage.set(SESSION_HINT_KEY, '1');
  else storage.remove(SESSION_HINT_KEY);
  listeners.forEach((l) => l());
}

export function getSession(): Session | null {
  return session;
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => session,
  );
}

async function load(auth: AuthResponse): Promise<Session> {
  setAccessToken(auth.accessToken);
  const boot = await api('/bootstrap', BootstrapResponse, { workspaceScoped: false });
  const remembered = storage.get(WORKSPACE_KEY);
  const workspaceId =
    boot.memberships.find((m) => m.workspaceId === remembered)?.workspaceId ??
    boot.memberships[0]?.workspaceId ??
    null;
  const next = { user: boot.user, memberships: boot.memberships, workspaceId };
  set(next);
  return next;
}

/** Returns the current session, restoring it from the refresh cookie after a reload. */
export function ensureSession(): Promise<Session | null> {
  if (session) return Promise.resolve(session);
  if (!storage.get(SESSION_HINT_KEY)) return Promise.resolve(null);
  restoring ??= (async () => {
    try {
      const auth = await refreshSession();
      if (!auth) {
        set(null);
        return null;
      }
      return await load(auth);
    } catch {
      return null;
    } finally {
      restoring = null;
    }
  })();
  return restoring;
}

export async function login(input: Omit<LoginRequest, 'client'>): Promise<Session> {
  const auth = await api('/auth/login', AuthResponse, {
    method: 'POST',
    body: { ...input, client: 'web' },
    workspaceScoped: false,
  });
  return load(auth);
}

export async function signup(input: Omit<SignupRequest, 'client'>): Promise<Session> {
  const auth = await api('/auth/signup', AuthResponse, {
    method: 'POST',
    body: { ...input, client: 'web' },
    workspaceScoped: false,
  });
  return load(auth);
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', z.null(), { method: 'POST', workspaceScoped: false });
  } finally {
    setAccessToken(null);
    set(null);
  }
}

/** Called by the API client when a refresh fails: drop the session and go to /login. */
export function onSessionExpired(handler: () => void): void {
  setSessionExpiredHandler(() => {
    set(null);
    handler();
  });
}
