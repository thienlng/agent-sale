import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { RunTraceToggle } from './run-trace';

const admin = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { isPlatformAdmin: admin.value } }),
}));
afterEach(() => {
  admin.value = false;
});

const meta = { model: 'gpt-6-luna', tokens: 56_461, latencyMs: 12_600 };

describe('RunTraceToggle', () => {
  it('shows an owner only the time, in Vietnamese digits (AS-9)', () => {
    renderWithProviders(<RunTraceToggle open={false} onToggle={() => {}} meta={meta} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/Xem các bước\s*· 12,6 giây$/);
    expect(screen.queryByText(/gpt-6-luna/)).toBeNull();
  });

  it('shows the platform team the model and tokens with Vietnamese digits', () => {
    admin.value = true;
    renderWithProviders(<RunTraceToggle open={false} onToggle={() => {}} meta={meta} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(
      /gpt-6-luna · 56\.461 token · 12,6 giây/,
    );
  });
});
