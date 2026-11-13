import { createRootRoute, Outlet } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

import { NotFound, RouteError } from '@/components/route-errors';

// Toasts are never needed for the first paint; keep sonner out of the entry chunk.
const Toaster = lazy(() => import('@/components/ui/sonner').then((m) => ({ default: m.Toaster })));
// "Confirm it's you" for sensitive actions (docs/09 §2): only needed once the user acts.
const StepUpHost = lazy(() =>
  import('@/components/step-up-dialog').then((m) => ({ default: m.StepUpHost })),
);

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Suspense>
        <Toaster position="top-center" />
        <StepUpHost />
      </Suspense>
    </>
  ),
  notFoundComponent: NotFound,
  errorComponent: ({ error }) => <RouteError error={error} />,
});
