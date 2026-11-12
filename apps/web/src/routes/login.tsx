import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { LoginLayout } from '@/features/identity/components/login-layout';
import { type GoogleReturn, LoginForm } from '@/features/identity/components/login-form';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { completeGoogleSignIn, ensureSession } from '@/lib/session';

/**
 * Only same-app paths are accepted as a post-login target (no open redirect). The server sends a
 * Google sign-in back here with `google=done` (refresh cookie set), `google=mfa` (code needed), `google=verify` (a new
 * account waits for the code emailed to its address) or
 * `google_error=<reason>`.
 */
const Search = z.object({
  redirect: z.string().startsWith('/').catch('/app/analytics').optional(),
  google: z.enum(['done', 'mfa', 'verify']).optional().catch(undefined),
  google_error: z.string().max(40).optional().catch(undefined),
});

export const Route = createFileRoute('/login')({
  validateSearch: Search,
  beforeLoad: async ({ search }) => {
    const session = search.google === 'done' ? await completeGoogleSignIn() : await ensureSession();
    if (session) throw redirect({ href: safeRedirectPath(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const safe = safeRedirectPath(search.redirect);
  // `google=done` only renders when the cookie did not turn into a session.
  const google: GoogleReturn | undefined =
    search.google === 'mfa'
      ? { step: 'mfa' }
      : search.google === 'verify'
        ? { step: 'verify' }
        : search.google === 'done'
          ? { step: 'error', reason: 'expired' }
          : search.google_error
            ? { step: 'error', reason: search.google_error }
            : undefined;
  return (
    <LoginLayout>
      <LoginForm
        redirect={search.redirect ? safe : undefined}
        google={google}
        onSuccess={() => void navigate({ href: safe, replace: true })}
      />
    </LoginLayout>
  );
}
