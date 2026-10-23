import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

import { Providers } from '@/app/providers';

/** Render with app providers (i18n, query). Routing is tested through the router separately. */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}
