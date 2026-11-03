import { OfferingDetails, type ProductDto } from '@agent-sales/contracts';

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
  /**
   * Absent for accommodations (reference tariffs live in the details) and for a course or service
   * whose every price is 0 (not published: `priceNote` says what to tell the customer).
   */
  fromVnd?: number;
  toVnd?: number;
  /** Retail products only: courses, services and accommodations have no stock. */
  inStock?: boolean;
  catalogKind?: 'accommodation' | 'course' | 'service';
  /** A course or service's price wording ("liên hệ", "từ", "giá tham khảo"), when set. */
  priceNote?: string;
  summary: string;
  imageCount: number;
}

export interface ProductDetails extends CompactProduct {
  description: string;
  instructions: string;
  /** `available` is absent for a course or a service. */
  variants?: { sku: string; name: string; priceVnd: number; available?: number }[];
  images: { id: string; label: string }[];
  accommodation?: unknown;
  offering?: Record<string, unknown>;
  availability?: 'unverified';
}

const imageList = (p: ProductDto) => productImages([p]).map(({ id, label }) => ({ id, label }));

/**
 * A product of a request business (education, spa, saas) seen as an offering of the industry's
 * kind when it has none, so the bot never reads it as out-of-stock retail with a price of 0. A
 * product with tracked stock (an inventory row on any variant), an accommodation or an offering
 * stays as it is: a spa may sell retail cosmetics.
 */
export function withDefaultOffering(
  p: ProductDto,
  kind: OfferingDetails['kind'] | null,
): ProductDto {
  if (!kind || p.offering || p.accommodation || p.variants.some((v) => v.stock.length > 0))
    return p;
  return { ...p, offering: OfferingDetails.parse({ kind }) };
}

export function compactProduct(p: ProductDto): CompactProduct {
  const base = {
    id: p.id,
    name: p.name,
    category: p.category,
    summary: cleanDescription(p.description, SUMMARY_MAX),
    imageCount: imageList(p).length,
  };
  if (p.accommodation) return { ...base, catalogKind: 'accommodation' };
  if (p.offering) {
    // A price of 0 is "not published": the range covers the published prices only.
    const prices = p.variants.map((v) => v.price).filter((price) => price > 0);
    const note = p.offering.priceNote.trim();
    return {
      id: base.id,
      name: base.name,
      category: base.category,
      catalogKind: p.offering.kind,
      ...(prices.length ? { fromVnd: Math.min(...prices), toVnd: Math.max(...prices) } : {}),
      ...(note ? { priceNote: note } : {}),
      summary: base.summary,
      imageCount: base.imageCount,
    };
  }
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
  // The compact row already carries the price note of a course or service.
  if ('offering' in rest && rest.offering) {
    const { priceNote: _note, ...facts } = rest.offering;
    rest.offering = facts;
  }
  return {
    ...compact,
    ...rest,
    description: cleanDescription(p.description, DESCRIPTION_MAX),
    instructions: cleanDescription(instructions, DESCRIPTION_MAX),
    images: imageList(p),
  } as ProductDetails;
}
