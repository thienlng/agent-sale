import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The module reads the saved choice once, at load: import it fresh per case. */
async function visibleIds() {
  vi.resetModules();
  const { useVisibleOrderColumns } = await import('./order-columns');
  return renderHook(() => useVisibleOrderColumns()).result.current.map((c) => c.id);
}

afterEach(() => window.localStorage.clear());

describe('order columns: "Người tạo"', () => {
  it('is visible by default and replaces the old hidden creator column', async () => {
    const ids = await visibleIds();
    expect(ids).toContain('creator');
    expect(ids).not.toContain('createdBy');
  });

  it('also shows for a column choice saved before it existed', async () => {
    window.localStorage.setItem('rapiz.orders.columns', 'code,customer,total,createdBy,status');
    const ids = await visibleIds();
    expect(ids).toEqual(['code', 'customer', 'total', 'creator', 'status']);
  });

  it('stays hidden once the user hides it again', async () => {
    window.localStorage.setItem('rapiz.orders.columns', 'code,customer');
    vi.resetModules();
    (await import('./order-columns')).toggleOrderColumn('creator');
    expect(await visibleIds()).toEqual(['code', 'customer', 'status']);
  });
});
