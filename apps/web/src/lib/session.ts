import {
  type AccountMembershipDto,
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
  setWorkspaceLostHandler,
} from './api-client';
import { storage } from './storage';

/**
 * Who is logged in and which workspace they act on. Kept outside React so
 * route guards (beforeLoad) and the API client can read it synchronously.
 */
export interface Session {
  user: UserDto;
  /** Accounts the user owns or bills for: where they can create a business. */
  accounts: AccountMembershipDto[];
  memberships: MembershipDto[];
  /** Null when the user has no business, or several and has not chosen one yet. */
  workspaceId: string | null;
}

const WORKSPACE_KEY = 'rapiz.workspace';
/** Set while this browser holds a session, so a first visit to /login makes no refresh call. */
const SESSION_HINT_KEY = 'rapiz.session';

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
  const next = fromBootstrap(boot, storage.get(WORKSPACE_KEY));
  set(next);
  return next;
}

/**
 * The preferred business if the user is still a member of it, else their only business.
 * With several businesses and no valid preference the user chooses (/businesses).
 */
function fromBootstrap(boot: BootstrapResponse, preferred: string | null | undefined): Session {
  const workspaceId =
    boot.memberships.find((m) => m.workspaceId === preferred)?.workspaceId ??
    (boot.memberships.length === 1 ? (boot.memberships[0]?.workspaceId ?? null) : null);
  return { user: boot.user, accounts: boot.accounts, memberships: boot.memberships, workspaceId };
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

/**
 * Reloads memberships (e.g. after joining a workspace through an invitation)
 * and, when given, switches to that workspace.
 */
export async function reloadSession(workspaceId?: string): Promise<Session | null> {
  const current = getSession();
  if (!current) return null;
  const boot = await api('/bootstrap', BootstrapResponse, { workspaceScoped: false });
  const next = fromBootstrap(boot, workspaceId ?? current.workspaceId);
  set(next);
  return next;
}

/** Select only an already-authorized business; the server still checks every tenant request. */
export function selectWorkspace(workspaceId: string): boolean {
  const current = getSession();
  if (!current?.memberships.some((member) => member.workspaceId === workspaceId)) return false;
  set({ ...current, workspaceId });
  return true;
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

/**
 * Called when the server says the user lost access to a business (removed, or the business
 * is gone). The session is reloaded; the handler runs when the current business was the one lost.
 */
export function onWorkspaceLost(handler: () => void): void {
  let reloading = false;
  setWorkspaceLostHandler((lost) => {
    const current = getSession();
    // Several queries fail at once; one reload answers them all.
    if (!current || reloading) return;
    reloading = true;
    void reloadSession()
      .then((next) => {
        if (current.workspaceId === lost && next?.workspaceId !== lost) handler();
      })
      .catch(() => undefined)
      .finally(() => {
        reloading = false;
      });
  });
}
