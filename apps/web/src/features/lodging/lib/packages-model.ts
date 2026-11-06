import type { PackageDto, PackageInput } from '@agent-sales/contracts';

/** Packages per target (server limit). */
export const MAX_PACKAGES = 10;

/**
 * One bedroom package being edited. `key` is the saved id for a loaded package and a
 * fresh uuid for a new one (rates refer to it by `packageKey`); empty number fields
 * are null until filled.
 */
export interface PackageDraft {
  key: string;
  id: string | null;
  unitId: string | null;
  name: string;
  bedrooms: number | null;
  standardAdults: number | null;
  standardChildren: number;
  maxGuests: number | null;
}

export const packageDraftOf = (k: PackageDto): PackageDraft => ({
  key: k.id,
  id: k.id,
  unitId: k.unitId,
  name: k.name,
  bedrooms: k.bedrooms,
  standardAdults: k.standardAdults,
  standardChildren: k.standardChildren,
  maxGuests: k.maxGuests,
});

export const newPackage = (unitId: string | null): PackageDraft => ({
  key: crypto.randomUUID(),
  id: null,
  unitId,
  name: '',
  bedrooms: null,
  standardAdults: null,
  standardChildren: 0,
  maxGuests: null,
});

/** The PUT body entry; only called once `validatePackages` passed. */
export const packageInputOf = (k: PackageDraft): PackageInput => ({
  ...(k.id ? { id: k.id } : {}),
  key: k.key,
  unitId: k.unitId,
  name: k.name.trim(),
  bedrooms: k.bedrooms ?? 0,
  standardAdults: k.standardAdults ?? 0,
  standardChildren: k.standardChildren,
  maxGuests: k.maxGuests,
});

export type PackageField =
  'name' | 'bedrooms' | 'standardAdults' | 'standardChildren' | 'maxGuests';

/** Problem codes per field; each maps to `packages.errors.<code>` (lodging namespace). */
export type PackageProblems = Partial<Record<PackageField, string>>;

const inRange = (v: number | null, min: number, max: number) =>
  v !== null && Number.isInteger(v) && v >= min && v <= max;

/**
 * Field problems per package key, mirroring the server: name 1–50 and unique per
 * target (case-insensitive), bedrooms 1–100 and distinct per target, standard adults
 * 1–1000, children 0–1000, max empty or 1–2000.
 */
export function validatePackages(packages: PackageDraft[]): Map<string, PackageProblems> {
  const out = new Map<string, PackageProblems>();
  const count = (pick: (k: PackageDraft) => string | number | null, k: PackageDraft) =>
    packages.filter((o) => o.unitId === k.unitId && pick(o) === pick(k)).length;
  for (const k of packages) {
    const p: PackageProblems = {};
    const name = k.name.trim();
    if (!name) p.name = 'nameRequired';
    else if (name.length > 50) p.name = 'nameTooLong';
    else if (count((o) => o.name.trim().toLowerCase(), k) > 1) p.name = 'nameDuplicate';
    if (!inRange(k.bedrooms, 1, 100)) p.bedrooms = 'bedroomsInvalid';
    else if (count((o) => o.bedrooms, k) > 1) p.bedrooms = 'bedroomsDuplicate';
    if (!inRange(k.standardAdults, 1, 1000)) p.standardAdults = 'adultsInvalid';
    if (!inRange(k.standardChildren, 0, 1000)) p.standardChildren = 'childrenInvalid';
    if (k.maxGuests !== null && !inRange(k.maxGuests, 1, 2000)) p.maxGuests = 'maxInvalid';
    if (Object.keys(p).length) out.set(k.key, p);
  }
  return out;
}
