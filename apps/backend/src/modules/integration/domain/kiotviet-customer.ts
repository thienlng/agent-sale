import { normalizeAnyPhone } from '@agent-sales/shared';

/**
 * KiotViet customers ↔ Rapiz customers (spec §4.4, PR 3). Pure. The field names (`contactNumber`,
 * `wardName`, `locationName`, `birthDate`, `gender`) and the gender flag's meaning come from the
 * public guide but were not checked on a store: they live here only, listed under "Still to
 * verify" in `docs/integrations/kiotviet.md`.
 */

/** KiotViet's `gender` flag (to verify on a trial store). */
export const KV_CUSTOMER_GENDER = { male: true, female: false } as const;

/** A KiotViet customer as the client reads it (`GET /customers`, `GET /customers/{id}`). */
export interface KvCustomer {
  id: number;
  code: string | null;
  name: string | null;
  contactNumber: string | null;
  email: string | null;
  address: string | null;
  wardName: string | null;
  /** Province and district, e.g. "Hà Nội - Quận Hoàn Kiếm". */
  locationName: string | null;
  birthDate: string | null;
  gender: boolean | null;
}

/** The CRM's `ExternalContactInput` (crm/api), structurally: raw values the crm module cleans. */
export interface KvContactFields {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthday: string | null;
  gender: 'male' | 'female' | null;
}

/** `POST /customers` body (spec §3). */
export interface KvCustomerBody {
  name: string;
  contactNumber: string;
  email?: string;
  address?: string;
  branchId: number;
}

/** What a push sends of a Rapiz customer (the crm `PushableContact`, PII stays in memory). */
export interface PushCustomer {
  name: string;
  phoneE164: string;
  email: string | null;
  address: string | null;
}

const blank = (v: string | null | undefined): string | null => {
  const t = v?.trim() ?? '';
  return t ? t : null;
};

/** The numbers of a KiotViet `contactNumber` (several may be typed into one field). */
const numbers = (raw: string | null): string[] =>
  (raw ?? '')
    .split(/[,;/|]/)
    .map((n) => n.trim())
    .filter(Boolean);

/**
 * A KiotViet customer as CRM input: the id as text, the first number of `contactNumber`, the
 * address joined with its ward and location, `gender` through `KV_CUSTOMER_GENDER`. The crm module
 * normalizes and validates every value (a number it cannot use is dropped, not an error).
 */
export function contactOfKvCustomer(c: KvCustomer): KvContactFields {
  const address = [c.address, c.wardName, c.locationName]
    .map(blank)
    .filter((p): p is string => p !== null)
    .join(', ');
  return {
    externalId: String(c.id),
    name: c.name?.trim() ?? '',
    phone: numbers(c.contactNumber)[0] ?? null,
    email: blank(c.email),
    address: address || null,
    birthday: blank(c.birthDate),
    gender:
      c.gender === KV_CUSTOMER_GENDER.male
        ? 'male'
        : c.gender === KV_CUSTOMER_GENDER.female
          ? 'female'
          : null,
  };
}

/** An E.164 number as KiotViet shops type it: `+84912…` → `0912…`; others unchanged. */
export function kiotVietPhone(e164: string): string {
  return e164.startsWith('+84') && e164.length === 12 ? `0${e164.slice(3)}` : e164;
}

/** Whether any number of a KiotViet `contactNumber` is this E.164 number. */
export function matchesPhone(contactNumber: string | null, e164: string): boolean {
  return numbers(contactNumber).some((n) => normalizeAnyPhone(n) === e164);
}

/** The `POST /customers` body; a customer without a name is named by its number. */
export function kiotVietCustomerBody(c: PushCustomer, branchId: number): KvCustomerBody {
  const contactNumber = kiotVietPhone(c.phoneE164);
  const body: KvCustomerBody = { name: blank(c.name) ?? contactNumber, contactNumber, branchId };
  const email = blank(c.email);
  const address = blank(c.address);
  if (email) body.email = email;
  if (address) body.address = address;
  return body;
}
