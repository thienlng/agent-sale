import type { ProductDto } from '@agent-sales/contracts';

import { catalogProductContext } from './catalog-context.js';
import { productImages } from './image-allowlist.js';

export const SUMMARY_MAX = 200;
export const DESCRIPTION_MAX = 1500;

/**
 * Customer-facing description text: drops "Nguồn:" lines and any line with a URL, collapses
 * whitespace and cuts at `max` characters on a word boundary.
 */
export function cleanDescription(text: string | null, max: number): string {
  if (!text) return '';
  const kept = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*Nguồn\s*:/i.test(line) && !/https?:\/\//i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (kept.length <= max) return kept;
  const cut = kept.slice(0, max);
  if (/\s/.test(kept[max] ?? '')) return cut.trimEnd();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

export interface CompactProduct {
  id: string;
  name: string;
  category: string | null;
  /** Absent for accommodations (reference tariffs live in the details). */
  fromVnd?: number;
  toVnd?: number;
  inStock?: boolean;
  catalogKind?: 'accommodation';
  summary: string;
  imageCount: number;
}

export interface ProductDetails extends CompactProduct {
  description: string;
  instructions: string;
  variants?: { sku: string; name: string; priceVnd: number; available: number }[];
  images: { id: string; label: string }[];
  accommodation?: unknown;
  availability?: 'unverified';
}

const imageList = (p: ProductDto) => productImages([p]).map(({ id, label }) => ({ id, label }));

export function compactProduct(p: ProductDto): CompactProduct {
  const base = {
    id: p.id,
    name: p.name,
    category: p.category,
    summary: cleanDescription(p.description, SUMMARY_MAX),
    imageCount: imageList(p).length,
  };
  if (p.accommodation) return { ...base, catalogKind: 'accommodation' };
  return {
    id: base.id,
    name: base.name,
    category: base.category,
    fromVnd: p.priceMin,
    toVnd: p.priceMax,
    inStock:
      p.variants.reduce((sum, v) => sum + v.stock.reduce((s, x) => s + x.available, 0), 0) > 0,
    summary: base.summary,
    imageCount: base.imageCount,
  };
}

export function productDetails(p: ProductDto): ProductDetails {
  const compact = compactProduct(p);
  const context = catalogProductContext(p);
  const { code: _code, description: _d, instructions, ...rest } = context;
  return {
    ...compact,
    ...rest,
    description: cleanDescription(p.description, DESCRIPTION_MAX),
    instructions: cleanDescription(instructions, DESCRIPTION_MAX),
    images: imageList(p),
  } as ProductDetails;
}
