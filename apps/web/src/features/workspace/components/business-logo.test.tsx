import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessLogo } from './business-logo';

const state = vi.hoisted(() => ({
  logoVersion: null as string | null,
  url: null as string | null,
  asked: [] as (string | null)[],
}));
vi.mock('../api/profile', () => ({
  useProfile: () => ({ data: { logoVersion: state.logoVersion } }),
  useLogoUrl: (version: string | null) => {
    state.asked.push(version);
    return { data: version ? state.url : undefined };
  },
}));

beforeEach(() => {
  state.logoVersion = null;
  state.url = null;
  state.asked = [];
});

describe('BusinessLogo', () => {
  it('shows the uploaded logo of the current business', () => {
    state.logoVersion = 'v2';
    state.url = 'blob:logo';
    const { container } = render(<BusinessLogo />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:logo');
    expect(state.asked).toContain('v2');
  });

  it('keeps the building icon when the business has no logo', () => {
    const { container } = render(<BusinessLogo />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
