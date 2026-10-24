import { describe, expect, it } from 'vitest';

import { InvalidOrderTransitionError } from './commerce.errors.js';
import { stockTransition } from './order-stock.js';

describe('stockTransition', () => {
  it('keeps held goods while the order moves through pre-shipping statuses', () => {
    expect(stockTransition('reserved', 'confirmed')).toEqual({ next: 'reserved', actions: [] });
    expect(stockTransition('reserved', 'packing')).toEqual({ next: 'reserved', actions: [] });
  });

  it('ships on the first shipped status only', () => {
    expect(stockTransition('reserved', 'delivering')).toEqual({
      next: 'shipped',
      actions: ['ship'],
    });
    expect(stockTransition('shipped', 'delivered')).toEqual({ next: 'shipped', actions: [] });
    expect(stockTransition('shipped', 'delivery_failed')).toEqual({ next: 'shipped', actions: [] });
  });

  it('cancelling releases held goods but refuses goods that already left', () => {
    expect(stockTransition('reserved', 'cancelled')).toEqual({
      next: 'released',
      actions: ['release'],
    });
    expect(() => stockTransition('shipped', 'cancelled')).toThrow(InvalidOrderTransitionError);
  });

  it('returns put goods back on hand; a re-opened order holds them again', () => {
    expect(stockTransition('shipped', 'returned')).toEqual({
      next: 'returned',
      actions: ['return'],
    });
    expect(stockTransition('returned', 'new')).toEqual({ next: 'reserved', actions: ['reserve'] });
    expect(stockTransition('released', 'confirmed')).toEqual({
      next: 'reserved',
      actions: ['reserve'],
    });
    expect(stockTransition('released', 'delivering')).toEqual({
      next: 'shipped',
      actions: ['reserve', 'ship'],
    });
    expect(stockTransition('shipped', 'packing')).toEqual({
      next: 'reserved',
      actions: ['return', 'reserve'],
    });
  });

  it('moves nothing when no goods are held or out', () => {
    expect(stockTransition('reserved', 'returned')).toEqual({
      next: 'released',
      actions: ['release'],
    });
    expect(stockTransition('released', 'returned')).toEqual({ next: 'released', actions: [] });
    expect(stockTransition('returned', 'cancelled')).toEqual({ next: 'released', actions: [] });
  });
});
