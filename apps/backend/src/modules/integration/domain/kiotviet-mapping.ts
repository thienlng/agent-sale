/**
 * KiotViet product → Rapiz catalog item (spec §5.1). Pure: plain types, no Zod (the client
 * validates responses in infrastructure/ and hands these shapes over).
 */

export interface KvInventory {
  branchId: number;
  onHand: number;
  reserved: number;
}

export interface KvProduct {
  id: number;
  code: string;
  name: string;
  fullName?: string;
  categoryName?: string | null;
  allowsSale?: boolean;
  hasVariants?: boolean;
  masterProductId?: number | null;
  masterUnitId?: number | null;
  unit?: string | null;
  conversionValue?: number | null;
  attributes?: Array<{ attributeName: string; attributeValue: string }>;
  basePrice?: number;
  weight?: number | null;
  images?: string[];
  description?: string | null;
  inventories?: KvInventory[];
}

export interface MappedVariant {
  externalId: string;
  sku: string;
  name: string;
  price: number;
  weightGram: number;
  position: number;
}

export interface MappedItem {
  externalId: string;
  name: string;
  description: string;
  category: string | null;
  active: boolean;
  /** KiotViet picture URLs; imported into Rapiz storage before the item reaches commerce. */
  sourceImageUrls: string[];
  variants: MappedVariant[];
}

/** Same cap as commerce's MAX_PRODUCT_IMAGES (domain does not import contracts). */
const MAX_IMAGES = 5;
/** The product form leaves a single variant unnamed; synced products do the same. */
const UNNAMED_VARIANT = '';

const isMaster = (p: KvProduct): boolean => (p.masterProductId ?? p.masterUnitId ?? null) === null;

/** Master id of a KiotViet product (itself when it is a master). */
export function masterOf(p: KvProduct): number {
  return p.masterProductId ?? p.masterUnitId ?? p.id;
}

const unitOf = (p: KvProduct): string => (p.unit ?? '').trim();

function variantName(p: KvProduct, withUnit: boolean): string {
  const parts = (p.attributes ?? []).map((a) => a.attributeValue.trim()).filter(Boolean);
  if (withUnit && unitOf(p)) parts.push(unitOf(p));
  return parts.length ? parts.join(' / ') : UNNAMED_VARIANT;
}

/**
 * Groups a page set of KiotViet products into catalog items keyed by master id, in first-seen
 * order. The master is variant position 0 and its children follow by id. Children whose master
 * is not in the set are still grouped under the master id, with product fields taken from the
 * first child and position 0 left free: the caller fetches the master by id and regroups.
 */
export function groupKvProducts(products: KvProduct[]): MappedItem[] {
  const groups = new Map<
    number,
    { first: KvProduct; master: KvProduct | null; children: KvProduct[] }
  >();
  for (const p of products) {
    const id = masterOf(p);
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { first: p, master: null, children: [] }));
    if (isMaster(p)) group.master = p;
    else group.children.push(p);
  }

  return [...groups.entries()].map(([id, { first, master, children }]) => {
    const head = master ?? first;
    const sorted = [...children].sort((a, b) => a.id - b.id);
    const members = master ? [master, ...sorted] : sorted;
    const withUnit = new Set(members.map(unitOf)).size > 1;
    const offset = master ? 0 : 1;
    return {
      externalId: String(id),
      name: head.name,
      description: stripHtml(head.description ?? ''),
      category: head.categoryName ?? null,
      active: head.allowsSale !== false,
      sourceImageUrls: (head.images ?? []).slice(0, MAX_IMAGES),
      variants: members.map((p, i) => ({
        externalId: String(p.id),
        sku: p.code,
        name: variantName(p, withUnit),
        price: Math.round(p.basePrice ?? 0),
        weightGram: Math.round(p.weight ?? 0),
        position: i + offset,
      })),
    };
  });
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code =
        ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : Number(ent.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** KiotViet descriptions are HTML; the catalog stores plain text with line breaks kept. */
export function stripHtml(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
