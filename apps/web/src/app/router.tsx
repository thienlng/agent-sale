import { createRouter } from '@tanstack/react-router';

import { routeTree } from '../routeTree.gen';

/** Preload on intent = instant navigation (docs/16 §1). */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
