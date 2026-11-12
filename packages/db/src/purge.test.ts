import { describe, expect, it } from 'vitest';

import { deleteOrder } from './purge.js';

describe('deleteOrder', () => {
  it('puts children before their parents and keeps a stable order otherwise', () => {
    const order = deleteOrder(
      ['contacts', 'contact_notes', 'orders', 'order_items', 'tags'],
      [
        { child: 'contact_notes', parent: 'contacts', onDelete: 'a' },
        { child: 'order_items', parent: 'orders', onDelete: 'c' },
        { child: 'orders', parent: 'contacts', onDelete: 'n' },
        // Outside the purge set: ignored.
        { child: 'notification_deliveries', parent: 'notifications', onDelete: 'c' },
      ],
    ).map((t) => t.name);
    expect(order.indexOf('contact_notes')).toBeLessThan(order.indexOf('contacts'));
    expect(order.indexOf('order_items')).toBeLessThan(order.indexOf('orders'));
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('contacts'));
    expect(order).toHaveLength(5);
  });

  it('deletes a table that references itself without cascade in one statement', () => {
    const [items, tree] = deleteOrder(
      ['items', 'tree'],
      [
        { child: 'items', parent: 'items', onDelete: 'c' },
        { child: 'tree', parent: 'tree', onDelete: 'a' },
      ],
    );
    expect(items).toEqual({ name: 'items', singleStatement: false });
    expect(tree).toEqual({ name: 'tree', singleStatement: true });
  });

  it('refuses a foreign-key cycle between tables', () => {
    expect(() =>
      deleteOrder(
        ['a', 'b'],
        [
          { child: 'a', parent: 'b', onDelete: 'a' },
          { child: 'b', parent: 'a', onDelete: 'a' },
        ],
      ),
    ).toThrow(/cycle among a, b/);
  });
});
