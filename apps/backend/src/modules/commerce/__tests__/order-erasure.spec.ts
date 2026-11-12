import { DELETED_CUSTOMER_NAME } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { ContactErasure } from '../../crm/api/index.js';
import { OrderErasure } from '../application/contact-erasure.js';
import type {
  ErasableOrder,
  OrderErasureStore,
  OrderErasureTx,
} from '../application/ports/order-erasure-store.js';
import {
  anonymizeOrderPeople,
  isDeletedCustomersOrder,
  sameName,
} from '../domain/order-anonymize.js';

const phones = ['84912345678', '0912345678'];

describe('anonymizeOrderPeople', () => {
  it('keeps only the placeholder name of the customer', () => {
    const out = anonymizeOrderPeople(
      {
        customer: { name: 'Lan', phone: '0912 345 678', email: 'lan@x.vn', gender: 'female' },
        recipient: { name: 'Lan', phone: '0912345678', address: '1 Lê Lợi', province: 'HCM' },
      },
      phones,
      'Khách đã xoá',
    );
    expect(out).toEqual({
      customer: { name: 'Khách đã xoá' },
      recipient: { name: 'Khách đã xoá' },
    });
  });

  it('anonymizes a recipient with the customer phone even under another name', () => {
    const out = anonymizeOrderPeople(
      {
        customer: { name: 'Lan', phone: '+84 912 345 678' },
        recipient: { name: 'Chị Lan', phone: '0912345678' },
      },
      phones,
      'X',
    );
    expect(out.recipient).toEqual({ name: 'X' });
  });

  it('keeps a recipient who is somebody else (a gift)', () => {
    const recipient = { name: 'Bình', phone: '0987654321', address: '2 Hai Bà Trưng' };
    const out = anonymizeOrderPeople(
      { customer: { name: 'Lan', phone: '0912345678' }, recipient },
      phones,
      'X',
    );
    expect(out).toEqual({ customer: { name: 'X' }, recipient });
  });
});

describe('OrderErasure', () => {
  it('deletes drafts, anonymizes matched orders and rebuilds their search text', async () => {
    const order: ErasableOrder = {
      id: newId(),
      conversationId: 'c1',
      code: 'DH0001',
      trackingCode: null,
      customer: { name: 'Lan', phone: '0912345678' },
      recipient: { name: 'Lan', phone: '0912345678', address: '1 Lê Lợi' },
      noteInternal: 'giao giờ hành chính',
      notePrint: '',
    };
    const calls: unknown[] = [];
    const tx: OrderErasureTx = {
      deleteDrafts: async (ids) => {
        calls.push(['drafts', ids]);
      },
      ordersOf: async (ids, digits) => {
        calls.push(['orders', ids, digits]);
        return [order];
      },
      anonymize: async (id, people, searchText) => {
        calls.push(['anonymize', id, people, searchText]);
      },
    };
    const store: OrderErasureStore = { run: async (_ws, fn) => fn(tx) };
    const erasure: ContactErasure = {
      workspaceId: workspaceId(newId()),
      contactId: newId(),
      phoneE164: '+84912345678',
      name: 'Lan',
      conversationIds: ['c1'],
      counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
    };
    await new OrderErasure(store).detach(erasure);
    expect(erasure.counts.orders).toBe(1);
    expect(calls[0]).toEqual(['drafts', ['c1']]);
    expect(calls[1]).toEqual(['orders', ['c1'], phones]);
    const [, id, people, searchText] = calls[2] as [string, string, unknown, string];
    expect(id).toBe(order.id);
    expect(people).toEqual({
      customer: { name: DELETED_CUSTOMER_NAME },
      recipient: { name: DELETED_CUSTOMER_NAME },
    });
    expect(searchText).toContain('dh0001');
    expect(searchText).not.toContain('0912345678');
    expect(searchText).not.toContain('le loi');
  });

  it('matches by conversation only when the customer has no phone', async () => {
    let digits: readonly string[] = ['unset'];
    const tx = {
      deleteDrafts: async () => undefined,
      ordersOf: async (_ids: readonly string[], d: readonly string[]) => {
        digits = d;
        return [];
      },
      anonymize: async () => undefined,
    } satisfies OrderErasureTx;
    const erasure: ContactErasure = {
      workspaceId: workspaceId(newId()),
      contactId: newId(),
      phoneE164: null,
      name: null,
      conversationIds: [],
      counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
    };
    await new OrderErasure({ run: async (_ws, fn) => fn(tx) }).detach(erasure);
    expect(digits).toEqual([]);
    expect(erasure.counts.orders).toBe(0);
  });

  it("keeps an order found only by a shared phone under another person's name", async () => {
    const base = {
      code: 'DH',
      trackingCode: null,
      recipient: {},
      noteInternal: '',
      notePrint: '',
    };
    const orders: ErasableOrder[] = [
      // Staff typed it for her husband, with the family phone: stays.
      { ...base, id: 'husband', conversationId: null, customer: { name: 'Trần Văn Nam' } },
      // Hers, typed by staff with spacing and case of their own.
      { ...base, id: 'hers', conversationId: null, customer: { name: '  nguyễn thị  LAN ' } },
      // No name typed: the phone is all there is.
      { ...base, id: 'nameless', conversationId: null, customer: { phone: '0912345678' } },
      // From her conversation: hers whatever the name says.
      { ...base, id: 'chat', conversationId: 'c1', customer: { name: 'Chị Hai' } },
    ];
    const anonymized: string[] = [];
    const tx: OrderErasureTx = {
      deleteDrafts: async () => undefined,
      ordersOf: async () => orders,
      anonymize: async (id) => {
        anonymized.push(id);
      },
    };
    const erasure: ContactErasure = {
      workspaceId: workspaceId(newId()),
      contactId: newId(),
      phoneE164: '+84912345678',
      name: 'Nguyễn Thị Lan',
      conversationIds: ['c1'],
      counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
    };
    await new OrderErasure({ run: async (_ws, fn) => fn(tx) }).detach(erasure);
    expect(anonymized).toEqual(['hers', 'nameless', 'chat']);
    expect(erasure.counts.orders).toBe(3);
  });
});

describe('isDeletedCustomersOrder', () => {
  it('compares names loosely and needs no name for a conversation match', () => {
    expect(sameName(' Nguyễn  Thị Lan', 'nguyễn thị lan')).toBe(true);
    expect(sameName('Nguyễn Thị Lan', 'Nguyễn Thị Lân')).toBe(false);
    const order = (name: unknown, conversationId: string | null = null) => ({
      conversationId,
      customer: name === undefined ? {} : { name },
    });
    expect(isDeletedCustomersOrder(order('Lan'), [], 'lan')).toBe(true);
    expect(isDeletedCustomersOrder(order('Nam'), [], 'Lan')).toBe(false);
    expect(isDeletedCustomersOrder(order('Nam'), [], null)).toBe(false);
    expect(isDeletedCustomersOrder(order('  '), [], 'Lan')).toBe(true);
    expect(isDeletedCustomersOrder(order(undefined), [], 'Lan')).toBe(true);
    expect(isDeletedCustomersOrder(order('Nam', 'c1'), ['c1'], 'Lan')).toBe(true);
    expect(isDeletedCustomersOrder(order('Nam', 'c2'), ['c1'], 'Lan')).toBe(false);
  });
});
