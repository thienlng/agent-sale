import {
  type AccountMembershipDto,
  AuthProvidersResponse,
  AuthResponse,
  BootstrapResponse,
  type LoginRequest,
  type MembershipDto,
  type SignupBusinessRequest,
  SignupBusinessResponse,
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
import { clearPrivateBrowserState, PRIVATE_GENERATION_KEY } from './private-browser-state';

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

function set(next: Session | null, rotatePrivateState = true): void {
  const previous = session;
  session = next;
  if (!next || (previous && previous.user.id !== next.user.id))
    clearPrivateBrowserState(rotatePrivateState);
  setWorkspaceId(next?.workspaceId ?? null);
  if (next?.workspaceId) storage.set(WORKSPACE_KEY, next.workspaceId);
  if (next) storage.set(SESSION_HINT_KEY, '1');
  else if (rotatePrivateState) storage.remove(SESSION_HINT_KEY);
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
 * With several businesses and no valid preference the user chooses on the account overview.
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

/** Sign-in methods the server offers besides email + password (Google needs server config). */
export function authProviders(): Promise<AuthProvidersResponse> {
  return api('/auth/providers', AuthProvidersResponse, { workspaceScoped: false }).catch(() => ({
    google: false,
  }));
}

/** Where the browser goes to sign in with Google; it comes back to /login?google=… */
export function googleSignInUrl(redirect?: string): string {
  const query = redirect ? `?${new URLSearchParams({ redirect }).toString()}` : '';
  return `/api/v1/auth/google/start${query}`;
}

/** After Google's redirect the refresh cookie is set: turn it into a session. */
export async function completeGoogleSignIn(): Promise<Session | null> {
  const auth = await refreshSession();
  return auth ? load(auth) : null;
}

/** The second factor of a Google sign-in (the pending sign-in rides in an HttpOnly cookie). */
export async function verifyGoogleSignIn(code: string): Promise<Session> {
  const auth = await api('/auth/google/mfa', AuthResponse, {
    method: 'POST',
    body: { code },
    workspaceScoped: false,
  });
  return load(auth);
}

/** Emails the 6-digit signup code; signup needs it (ACC-01). 409 when the email has an account. */
export async function requestSignupCode(email: string, name?: string): Promise<void> {
  await api('/auth/signup/code', z.null(), {
    method: 'POST',
    body: name ? { email, name } : { email },
    workspaceScoped: false,
  });
}

/** Signup step 2: the first business (and the signup trial), then the session switches to it. */
export async function createFirstBusiness(input: SignupBusinessRequest): Promise<string> {
  const { workspaceId } = await api('/auth/signup/business', SignupBusinessResponse, {
    method: 'POST',
    body: input,
    workspaceScoped: false,
  });
  return workspaceId;
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

/** Keeps the name and logo shown in the business lists in step with a saved profile edit. */
export function syncMembership(
  workspaceId: string,
  profile: { name: string; logoVersion: string | null; icon: string },
): void {
  const current = getSession();
  if (!current) return;
  set({
    ...current,
    memberships: current.memberships.map((m) =>
      m.workspaceId === workspaceId
        ? {
            ...m,
            workspaceName: profile.name,
            logoVersion: profile.logoVersion,
            icon: profile.icon,
          }
        : m,
    ),
  });
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
let expiredHandler: (() => void) | undefined;
function expireSession(rotate = true): void {
  setAccessToken(null);
  set(null, rotate);
  expiredHandler?.();
}
export function onSessionExpired(handler: () => void): void {
  expiredHandler = handler;
  setSessionExpiredHandler(() => expireSession());
}

// A second tab must leave its authenticated view, not retain an unusable composer.
window.addEventListener('storage', (event) => {
  if (
    (event.key === SESSION_HINT_KEY && event.newValue === null) ||
    (event.key === PRIVATE_GENERATION_KEY && event.newValue !== event.oldValue) ||
    event.key === null
  )
    expireSession(false);
});

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
