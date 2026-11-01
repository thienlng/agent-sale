import { normalizeAnyPhone } from '@agent-sales/shared';
import { vi } from 'vitest';

import type { KvContactFields as ExternalContactInput } from '../domain/kiotviet-customer.js';

/** The crm `PushableContact`, structurally (tests may not import other modules outside specs). */
interface PushableContact {
  id: string;
  name: string;
  phoneE164: string;
  email: string | null;
  address: string | null;
}

export interface MemContact {
  id: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
  address: string | null;
  externalId: string | null;
  push: 'pending' | 'failed' | 'detached' | null;
  pushError: string | null;
  createdAt: Date;
}

/**
 * In-memory CONTACT_SYNC_FACADE (structurally) with the crm module's matching and push-state
 * rules. Specs make `markContactPushed` throw the crm errors with `mockRejectedValueOnce`.
 */
export class MemoryContacts {
  contacts: MemContact[] = [];
  upserts: ExternalContactInput[] = [];
  /** What `staleContactPushes` answers. */
  stale: string[] = [];
  private seq = 0;

  add(over: Partial<MemContact> = {}): MemContact {
    this.seq += 1;
    const c: MemContact = {
      id: `0190f5c2-0000-7000-8000-${String(this.seq).padStart(12, '0')}`,
      name: `Khách ${this.seq}`,
      phoneE164: null,
      email: null,
      address: null,
      externalId: null,
      push: null,
      pushError: null,
      createdAt: new Date(),
      ...over,
    };
    this.contacts.push(c);
    return c;
  }

  byId = (id: string): MemContact | undefined => this.contacts.find((c) => c.id === id);
  byExternal = (id: string): MemContact | undefined =>
    this.contacts.find((c) => c.externalId === id);

  upsertExternalContact = vi.fn(async (_ws: unknown, _s: unknown, input: ExternalContactInput) => {
    this.upserts.push(structuredClone(input));
    const phone = input.phone ? normalizeAnyPhone(input.phone) : null;
    if (!input.name.trim() && !phone && !input.email) return { skipped: 'no_identity' as const };
    const linked = this.byExternal(input.externalId);
    if (linked) {
      Object.assign(linked, { name: input.name, phoneE164: phone, address: input.address });
      return { contactId: linked.id, created: false, matchedBy: 'external' as const };
    }
    const byPhone = phone
      ? this.contacts.find((c) => c.phoneE164 === phone && c.externalId === null)
      : undefined;
    if (byPhone) {
      Object.assign(byPhone, { externalId: input.externalId, push: null, pushError: null });
      return { contactId: byPhone.id, created: false, matchedBy: 'phone' as const };
    }
    const c = this.add({
      name: input.name,
      phoneE164: phone,
      email: input.email,
      address: input.address,
      externalId: input.externalId,
    });
    return { contactId: c.id, created: true, matchedBy: 'new' as const };
  });

  unlinkExternalContacts = vi.fn(async (_ws: unknown, _s: unknown, ids: readonly string[]) => {
    const hit = this.contacts.filter((c) => c.externalId !== null && ids.includes(c.externalId));
    // A PMS delete: never pushed back (the crm 'detached' state).
    hit.forEach((c) => Object.assign(c, { externalId: null, push: 'detached', pushError: null }));
    return hit.length;
  });

  claimContactsForPush = vi.fn(async (_ws: unknown, _s: unknown, since: Date, limit: number) => {
    const rows = this.contacts
      .filter((c) => !c.externalId && !c.push && c.phoneE164 && c.createdAt >= since)
      .slice(0, limit);
    rows.forEach((c) => (c.push = 'pending'));
    return rows.map(pushable);
  });

  pushableContact = vi.fn(async (_ws: unknown, _s: unknown, id: string) => {
    const c = this.byId(id);
    return c && c.push === 'pending' && !c.externalId && c.phoneE164 ? pushable(c) : null;
  });

  markContactPushed = vi.fn(async (_ws: unknown, id: string, _s: unknown, externalId: string) => {
    const c = this.byId(id);
    if (!c) throw new Error('NOT_FOUND');
    if (c.externalId === externalId) return;
    if (c.externalId || this.byExternal(externalId)) throw new Error('link conflict');
    Object.assign(c, { externalId, push: null, pushError: null });
  });

  markContactPushFailed = vi.fn(async (_ws: unknown, id: string, code: string) => {
    const c = this.byId(id);
    if (c?.push !== 'pending') return;
    Object.assign(c, { push: 'failed', pushError: code });
  });

  releasePendingContactPushes = vi.fn(async () => {
    const hit = this.contacts.filter((c) => c.push === 'pending');
    hit.forEach((c) => (c.push = null));
    return hit.length;
  });

  releaseFailedContactPushes = vi.fn(async () => {
    const hit = this.contacts.filter((c) => c.push === 'failed');
    hit.forEach((c) => Object.assign(c, { push: null, pushError: null }));
    return hit.length;
  });

  staleContactPushes = vi.fn(async () => [...this.stale]);

  releaseExternalSource = vi.fn(async () => {
    const hit = this.contacts.filter((c) => c.externalId !== null);
    this.contacts.forEach((c) =>
      Object.assign(c, { externalId: null, push: c.push === 'detached' ? 'detached' : null }),
    );
    return hit.length;
  });

  linkedContactCount = vi.fn(async () => this.contacts.filter((c) => c.externalId !== null).length);

  externalIdOf = vi.fn(
    async (_ws: unknown, _s: unknown, id: string) => this.byId(id)?.externalId ?? null,
  );
}

function pushable(c: MemContact): PushableContact {
  return {
    id: c.id,
    name: c.name,
    phoneE164: c.phoneE164 ?? '',
    email: c.email,
    address: c.address,
  };
}
