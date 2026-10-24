import { createRootRoute, Outlet } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

import { NotFound, RouteError } from '@/components/route-errors';

// Toasts are never needed for the first paint; keep sonner out of the entry chunk.
const Toaster = lazy(() => import('@/components/ui/sonner').then((m) => ({ default: m.Toaster })));

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Suspense>
        <Toaster position="top-center" />
      </Suspense>
    </>
  ),
  notFoundComponent: NotFound,
  errorComponent: ({ error }) => <RouteError error={error} />,
});
