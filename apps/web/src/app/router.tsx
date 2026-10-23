import { createRouter } from '@tanstack/react-router';

import { onSessionExpired } from '@/lib/session';

import { routeTree } from '../routeTree.gen';

/** Preload on intent = instant navigation (docs/16 §1). */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

// A refresh that fails mid-session (expired or revoked) lands on /login, keeping the page.
onSessionExpired(() => {
  void router.navigate({ to: '/login', search: { redirect: router.state.location.href } });
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
