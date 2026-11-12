import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { IdentityFacade } from '../../identity/api/index.js';
import { ContactLifecycle, type ContactErasure } from '../api/contact-lifecycle.js';
import { ContactDeletionService } from '../application/contact-deletion.service.js';
import { emptyContact } from '../application/contact.service.js';
import type { ContactRecord, CrmStore, CrmTx } from '../application/ports/crm-store.js';
import { ContactNotFoundError } from '../domain/crm.errors.js';

const ws = workspaceId(newId());
const owner = { userId: newId(), role: 'owner' };
const identity = { displayName: async () => 'Chủ shop' } as unknown as IdentityFacade;

/** A store holding one customer; records what the delete transaction wrote. */
function storeWith(contact: ContactRecord | null) {
  let current = contact;
  const erased: Array<{ id: string; conversations: readonly string[] }> = [];
  const audits: unknown[] = [];
  const events: Array<{ type: string; aggregateId: string; payload: Record<string, unknown> }> = [];
  const tx = {
    contacts: { find: async (id: string) => (current?.id === id ? current : null) },
    eraseContact: async (id: string, conversations: readonly string[]) => {
      erased.push({ id, conversations });
      current = null;
    },
    audit: async (_ws: unknown, e: unknown) => {
      audits.push(e);
    },
    outbox: async (_ws: unknown, e: (typeof events)[number]) => {
      events.push(e);
    },
  } as unknown as CrmTx;
  const store: CrmStore = { run: async (_ws, fn) => fn(tx) };
  return { store, erased, audits, events };
}

function customer(patch: Partial<ContactRecord> = {}): ContactRecord {
  return {
    ...emptyContact(null, new Date()),
    name: 'Nguyễn Văn A',
    phone: '0912345678',
    phoneNormalized: '+84912345678',
    ...patch,
  };
}

describe('ContactLifecycle', () => {
  it('runs collect, then detach, then erase, whatever the registration order', async () => {
    const lifecycle = new ContactLifecycle();
    const order: string[] = [];
    lifecycle.onErase(async (e) => {
      order.push(`erase:${e.conversationIds.join(',')}`);
    });
    lifecycle.onDetach(async (e) => {
      order.push(`detach:${e.conversationIds.join(',')}`);
    });
    lifecycle.onCollect(async (e) => {
      order.push('collect');
      e.conversationIds.push('c1', 'c1', 'c2');
    });
    const erasure: ContactErasure = {
      workspaceId: ws,
      contactId: newId(),
      phoneE164: null,
      name: null,
      conversationIds: [],
      counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
    };
    await lifecycle.beforeDelete(erasure);
    // Duplicates from several collectors are merged before anyone acts on them.
    expect(order).toEqual(['collect', 'detach:c1,c2', 'erase:c1,c2']);
  });

  it('stops at the first failing step so nothing later runs', async () => {
    const lifecycle = new ContactLifecycle();
    const erase = vi.fn(async () => undefined);
    lifecycle.onDetach(async () => {
      throw new Error('orders unavailable');
    });
    lifecycle.onErase(erase);
    await expect(
      lifecycle.beforeDelete({
        workspaceId: ws,
        contactId: newId(),
        phoneE164: null,
        name: null,
        conversationIds: [],
        counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
      }),
    ).rejects.toThrow('orders unavailable');
    expect(erase).not.toHaveBeenCalled();
  });
});

describe('ContactDeletionService', () => {
  it('lets the other modules act, then deletes the customer with an audit event and an event', async () => {
    const c = customer();
    const { store, erased, audits, events } = storeWith(c);
    const lifecycle = new ContactLifecycle();
    const seen: ContactErasure[] = [];
    lifecycle.onCollect(async (e) => {
      e.conversationIds.push('conv-1');
    });
    lifecycle.onDetach(async (e) => {
      seen.push({ ...e });
      e.counts.orders += 2;
      e.counts.bookings += 1;
    });
    lifecycle.onErase(async (e) => {
      e.counts.conversations += 1;
      e.counts.messages += 12;
      e.counts.files += 1;
    });
    const service = new ContactDeletionService(store, identity, lifecycle);

    const result = await service.delete(ws, c.id, owner);

    expect(result).toEqual({
      contactId: c.id,
      conversations: 1,
      messages: 12,
      files: 1,
      orders: 2,
      bookings: 1,
    });
    // Orders carry only the phone, so the steps get it.
    expect(seen[0]).toMatchObject({
      contactId: c.id,
      phoneE164: '+84912345678',
      name: expect.anything(),
    });
    expect(erased).toEqual([{ id: c.id, conversations: ['conv-1'] }]);
    expect(audits).toEqual([
      {
        actorUserId: owner.userId,
        actorName: 'Chủ shop',
        action: 'contact.deleted',
        targetType: 'contact',
        targetId: c.id,
        data: { conversations: 1, messages: 12, files: 1, orders: 2, bookings: 1 },
      },
    ]);
    // No name, phone or message in the trail.
    expect(JSON.stringify(audits)).not.toContain('Nguyễn');
    expect(JSON.stringify(audits)).not.toContain('912345678');
    expect(events).toEqual([
      {
        type: 'crm.contact.deleted.v1',
        aggregateId: c.id,
        payload: {
          workspaceId: ws,
          contactId: c.id,
          actorUserId: owner.userId,
          occurredAt: expect.any(String),
        },
      },
    ]);
  });

  it('answers 404 for an unknown id or a malformed one, and asks no module', async () => {
    const { store } = storeWith(customer());
    const lifecycle = new ContactLifecycle();
    const collect = vi.fn(async () => undefined);
    lifecycle.onCollect(collect);
    const service = new ContactDeletionService(store, identity, lifecycle);
    await expect(service.delete(ws, newId(), owner)).rejects.toBeInstanceOf(ContactNotFoundError);
    await expect(service.delete(ws, 'not-a-uuid', owner)).rejects.toBeInstanceOf(
      ContactNotFoundError,
    );
    expect(collect).not.toHaveBeenCalled();
  });

  it('keeps the customer when a module fails, so the delete can be retried', async () => {
    const c = customer();
    const { store, erased, events } = storeWith(c);
    const lifecycle = new ContactLifecycle();
    lifecycle.onDetach(async () => {
      throw new Error('boom');
    });
    const service = new ContactDeletionService(store, identity, lifecycle);
    await expect(service.delete(ws, c.id, owner)).rejects.toThrow('boom');
    expect(erased).toEqual([]);
    expect(events).toEqual([]);
  });

  it('writes nothing more when a concurrent delete already removed the customer', async () => {
    const c = customer();
    const { store, erased, events } = storeWith(c);
    const lifecycle = new ContactLifecycle();
    // The other delete wins while this one's modules are still working.
    lifecycle.onErase(async () => {
      await store.run(ws, (tx) => tx.eraseContact(c.id, []));
    });
    const service = new ContactDeletionService(store, identity, lifecycle);
    await service.delete(ws, c.id, owner);
    expect(erased).toHaveLength(1);
    expect(events).toEqual([]);
  });
});
