import { normalizeAnyPhone } from '@agent-sales/shared';

/** The customer fields a PMS owns once a customer is linked (ADR-017, owner decision 2026-11-01). */
export interface ExternalContactFields {
  name: string | null;
  /** As the PMS wrote it; only kept when `normalizeAnyPhone` accepts it. */
  phone: string | null;
  email: string | null;
  address: string | null;
  birthday: string | null;
  gender: 'male' | 'female' | null;
}

/**
 * What each linked system owns (ADR-017 for a PMS, ADR-021 §3 for Rapiz HQ):
 * - `owned`: fields its changes overwrite on a linked customer;
 * - `locked`: fields staff may not edit while linked (the link keys of Rapiz HQ);
 * - `matchEmail`: adoption also matches an unlinked customer by email (after the phone).
 * A PMS owns the profile and never locks it; Rapiz owns only phone and email (the link keys) and
 * leaves the name to staff.
 */
export const EXTERNAL_SOURCE_RULES = {
  kiotviet: {
    owned: ['name', 'phone', 'email', 'address', 'birthday', 'gender'],
    locked: [],
    matchEmail: false,
  },
  rapiz: { owned: ['phone', 'email'], locked: ['phone', 'email'], matchEmail: true },
} as const satisfies Record<
  string,
  {
    owned: ReadonlyArray<keyof ExternalContactFields>;
    locked: ReadonlyArray<'phone' | 'email'>;
    matchEmail: boolean;
  }
>;
export type ExternalSourceKey = keyof typeof EXTERNAL_SOURCE_RULES;

/** Fields of a linked customer staff may not change (empty when unlinked or for a PMS). */
export function lockedFields(source: string | null): ReadonlyArray<'phone' | 'email'> {
  return source && source in EXTERNAL_SOURCE_RULES
    ? EXTERNAL_SOURCE_RULES[source as ExternalSourceKey].locked
    : [];
}

/** Restricts a patch to the fields the source owns; `name` too when the customer has none yet. */
export function ownedPatch(
  source: ExternalSourceKey,
  patch: Partial<ExternalContactFields>,
  hasName: boolean,
): Partial<ExternalContactFields> {
  const owned: ReadonlyArray<string> = EXTERNAL_SOURCE_RULES[source].owned;
  return Object.fromEntries(
    Object.entries(patch).filter(([k]) => owned.includes(k) || (k === 'name' && !hasName)),
  ) as Partial<ExternalContactFields>;
}

const NAME_MAX = 120;
const ADDRESS_MAX = 300;
const EMAIL_MAX = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/;
const EXTERNAL_ID_MAX = 64;

const text = (v: string | null, max: number): string | null => {
  const t = v?.trim() ?? '';
  return t ? t.slice(0, max) : null;
};

/**
 * Cleans a PMS record to what the CRM stores: trimmed text capped like the CRM form, an unusable
 * phone, a malformed email or a malformed birthday dropped (an import never fails on one field), a
 * date-time birthday cut to its date. Null when no name, usable phone or email is left.
 */
export function cleanExternalContact(c: {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthday: string | null;
  gender: 'male' | 'female' | null;
}): ExternalContactFields | null {
  const phone = text(c.phone, 40);
  const email = text(c.email, EMAIL_MAX);
  const out: ExternalContactFields = {
    name: text(c.name, NAME_MAX),
    phone: phone && normalizeAnyPhone(phone) ? phone : null,
    email: email && EMAIL.test(email) ? email : null,
    address: text(c.address, ADDRESS_MAX),
    birthday: DATE.exec(c.birthday?.trim() ?? '')?.[1] ?? null,
    gender: c.gender === 'male' || c.gender === 'female' ? c.gender : null,
  };
  return out.name || out.phone || out.email ? out : null;
}

/** A PMS id trimmed; null when empty or longer than 64 characters. */
export function normalizeExternalId(id: string): string | null {
  const t = id.trim();
  return t && t.length <= EXTERNAL_ID_MAX ? t : null;
}

/**
 * Fields the PMS sent a value for that the CRM could not use (an unusable phone, a malformed email
 * or birthday): an overwrite keeps the stored value instead of clearing it.
 */
export function rejectedFields(
  raw: Partial<Record<keyof ExternalContactFields, string | null>>,
  clean: ExternalContactFields,
): Array<keyof ExternalContactFields> {
  return (Object.keys(clean) as Array<keyof ExternalContactFields>).filter(
    (k) => Boolean(raw[k]?.trim()) && clean[k] === null,
  );
}

/**
 * The fields to write. A linked customer takes every PMS-owned field, nulls included (the PMS is the
 * source of truth), except values it sent in an unusable form (`rejected`). A customer adopted by phone match keeps what the PMS does not know yet, so
 * linking never wipes data staff entered.
 */
export function externalPatch(
  f: ExternalContactFields,
  mode: 'linked' | 'adopt',
  rejected: ReadonlyArray<keyof ExternalContactFields> = [],
): Partial<ExternalContactFields> {
  return Object.fromEntries(
    Object.entries(f).filter(
      ([k, v]) =>
        !rejected.includes(k as keyof ExternalContactFields) && (mode === 'linked' || v !== null),
    ),
  ) as Partial<ExternalContactFields>;
}

/**
 * Whether a PMS name is just one of these phone numbers (E.164). A customer pushed without a name
 * is named by its number in the PMS; that name coming back must not replace the stored one.
 */
export function isPhoneName(name: string | null | undefined, phones: ReadonlyArray<string | null>) {
  const asPhone = name ? normalizeAnyPhone(name) : null;
  return asPhone !== null && phones.includes(asPhone);
}
