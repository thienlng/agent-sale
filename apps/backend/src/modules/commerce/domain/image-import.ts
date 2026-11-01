/** Pure parts of the one-off import of externally linked product pictures (see the import CLI). */

export interface ImageHolder {
  imageUrls: readonly string[];
  accommodation: Record<string, unknown> | null;
}

const galleryOf = (accommodation: Record<string, unknown> | null): unknown[] =>
  Array.isArray(accommodation?.['gallery']) ? (accommodation['gallery'] as unknown[]) : [];

const galleryUrl = (item: unknown): string | null => {
  const url = (item as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : null;
};

/** Every picture URL of a product, in order: its pictures, then the lodging gallery. */
export function allImageUrls(p: ImageHolder): string[] {
  return [
    ...p.imageUrls,
    ...galleryOf(p.accommodation).flatMap((g) => {
      const url = galleryUrl(g);
      return url === null ? [] : [url];
    }),
  ];
}

/** Splits the product's URLs into already-stored and still-linked ones (`isOwn` = own-image rule). */
export function classifyImageUrls(
  p: ImageHolder,
  isOwn: (url: string) => boolean,
): { stored: number; external: string[] } {
  const urls = allImageUrls(p);
  const external = urls.filter((u) => !isOwn(u));
  return { stored: urls.length - external.length, external };
}

/** Replaces URLs by `replacements` (same order, other gallery fields kept). Null when nothing changes. */
export function rewriteImageUrls(
  p: ImageHolder,
  replacements: ReadonlyMap<string, string>,
): { imageUrls: string[]; accommodation: Record<string, unknown> | null } | null {
  let changed = false;
  const swap = (url: string): string => {
    const next = replacements.get(url);
    if (next === undefined || next === url) return url;
    changed = true;
    return next;
  };
  const imageUrls = p.imageUrls.map(swap);
  let accommodation = p.accommodation;
  if (accommodation && Array.isArray(accommodation['gallery'])) {
    const gallery = (accommodation['gallery'] as unknown[]).map((g) => {
      const url = galleryUrl(g);
      return url === null ? g : { ...(g as object), url: swap(url) };
    });
    accommodation = { ...accommodation, gallery };
  }
  return changed ? { imageUrls, accommodation } : null;
}
