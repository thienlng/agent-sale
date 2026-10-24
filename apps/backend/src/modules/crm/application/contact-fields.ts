import type { UpdateContactRequest } from '@agent-sales/contracts';
import { normalizeAnyPhone, normalizeEmail } from '@agent-sales/shared';
import type { z } from 'zod';

import { InvalidContactError } from '../domain/crm.errors.js';
import { contactSearchText } from './crm.mappers.js';
import type { ContactRecord } from './ports/crm-store.js';

type ContactFields = Omit<z.output<typeof UpdateContactRequest>, 'expectedVersion'>;

/**
 * The contact after applying the sent fields (undefined = unchanged, null = cleared).
 * Phone/address "provided at" are set when the value first appears and cleared
 * with it, never touched by other edits. The first source is kept once set.
 */
export function applyFields(
  before: ContactRecord,
  f: Partial<ContactFields>,
  now: Date,
): ContactRecord {
  const next: ContactRecord = { ...before };
  const set = <K extends keyof ContactFields & keyof ContactRecord>(k: K) => {
    if (f[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = f[k];
  };
  for (const k of [
    'name',
    'birthday',
    'gender',
    'address',
    'province',
    'ward',
    'sourceId',
    'statusId',
    'salesUserId',
    'careUserId',
    'adRef',
  ] as const) {
    set(k);
  }
  if (f.profileNote !== undefined) next.profileNote = f.profileNote ?? '';
  if (f.phone !== undefined) {
    next.phone = f.phone;
    next.phoneNormalized = f.phone ? normalizeAnyPhone(f.phone) : null;
    if (f.phone && !next.phoneNormalized) {
      throw new InvalidContactError({ phone: 'not a usable phone number' });
    }
  }
  if (f.email !== undefined) {
    next.email = f.email;
    next.emailNormalized = f.email ? normalizeEmail(f.email) : null;
  }
  if (!next.name && !next.phone && !next.email) {
    throw new InvalidContactError({ name: 'give a name, a phone number or an email' });
  }
  if (next.phone !== before.phone) {
    next.phoneProvidedAt = next.phone ? (before.phone ? before.phoneProvidedAt : now) : null;
  }
  if (next.address !== before.address) {
    next.addressProvidedAt = next.address
      ? before.address
        ? before.addressProvidedAt
        : now
      : null;
  }
  next.firstSourceId = before.firstSourceId ?? next.sourceId;
  next.searchText = contactSearchText(next);
  return next;
}
