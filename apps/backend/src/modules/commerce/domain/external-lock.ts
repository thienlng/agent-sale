/**
 * Fields a PMS owns on a linked product (ADR-017, spec §5.4). Staff edit them in the PMS; Rapiz
 * keeps `visibleToBot`, `botInstructions` and the bot selection editable.
 */
export const LOCKED_PRODUCT_FIELDS = [
  'name',
  'description',
  'category',
  'imageUrls',
  'status',
  'variants',
] as const;
export type LockedField = (typeof LOCKED_PRODUCT_FIELDS)[number] | 'stock';

export interface LockableVariant {
  /** Absent for a variant the update adds. */
  id?: string | undefined;
  sku: string;
  name: string;
  price: number;
  cost: number;
  weightGram: number;
}

export interface LockableProduct {
  name: string;
  description: string;
  category?: string | null | undefined;
  imageUrls: readonly string[];
  status: 'active' | 'archived';
  variants: readonly LockableVariant[];
}

function sameVariants(a: readonly LockableVariant[], b: readonly LockableVariant[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((v) => [v.id, v]));
  return b.every((n) => {
    const c = n.id === undefined ? undefined : byId.get(n.id);
    return (
      c !== undefined &&
      c.sku === n.sku &&
      c.name === n.name &&
      c.price === n.price &&
      c.cost === n.cost &&
      c.weightGram === n.weightGram
    );
  });
}

/**
 * The first linked field an update changes, or null. Variants compare (sku, name, price, cost,
 * weightGram) by id and the id set; their order is not linked. Picture order is.
 */
export function lockedChange(current: LockableProduct, next: LockableProduct): LockedField | null {
  const checks: Record<(typeof LOCKED_PRODUCT_FIELDS)[number], () => boolean> = {
    name: () => current.name === next.name,
    description: () => current.description === next.description,
    category: () => (current.category ?? null) === (next.category ?? null),
    imageUrls: () =>
      current.imageUrls.length === next.imageUrls.length &&
      current.imageUrls.every((u, i) => u === next.imageUrls[i]),
    status: () => current.status === next.status,
    variants: () => sameVariants(current.variants, next.variants),
  };
  return LOCKED_PRODUCT_FIELDS.find((f) => !checks[f]()) ?? null;
}
