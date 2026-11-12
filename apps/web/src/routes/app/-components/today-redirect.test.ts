import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { Route } from '../today';

/** Runs the route's `beforeLoad` and returns what it threw. */
function thrownBy(hash: string): unknown {
  const beforeLoad = Route.options.beforeLoad as unknown as (ctx: {
    location: { hash: string };
  }) => void;
  try {
    beforeLoad({ location: { hash } });
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('/app/today', () => {
  it('sends old links to the statistics page, which holds "Việc hôm nay"', () => {
    const thrown = thrownBy('');
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: Record<string, unknown> }).options).toMatchObject({
      to: '/app/analytics',
      replace: true,
    });
    expect((thrown as { options: Record<string, unknown> }).options).not.toHaveProperty('hash');
  });

  it('keeps the hash, so a link to one queue still lands on it', () => {
    const thrown = thrownBy('queue-tasks') as { options: Record<string, unknown> };
    expect(thrown.options).toMatchObject({ to: '/app/analytics', hash: 'queue-tasks' });
  });
});
