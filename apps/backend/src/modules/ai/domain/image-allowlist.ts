import { foldVietnamese } from '@agent-sales/shared';

/** One picture the bot may send this turn. The model only ever sees `id` and `label`. */
export interface AllowedImage {
  id: string;
  label: string;
  url: string;
}

export const MAX_ALLOWED_IMAGES = 10;
export const MAX_SENT_IMAGES = 3;

const isHttps = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Words that appear in "show me the picture" requests and say nothing about which item. */
const NOISE = new Set([
  'xem',
  'anh',
  'hinh',
  'mau',
  'cho',
  'khong',
  'nay',
  'nao',
  'gui',
  'chup',
  'the',
  'minh',
  'toi',
  'ban',
  'con',
  'shop',
  'hang',
  'cua',
  'duoc',
  'giup',
  'with',
  'show',
  'photo',
  'picture',
  'image',
]);

const words = (text: string): string[] =>
  foldVietnamese(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NOISE.has(word));

/**
 * The pictures of the retrieved products, ids `p:<productId>:<index>`. Anything that is not an
 * https URL is dropped even though the API already validates it.
 */
export function productImages(
  products: readonly { id: string; name: string; imageUrls?: readonly string[] }[],
): AllowedImage[] {
  return products.flatMap((product) => {
    const urls = (product.imageUrls ?? []).filter(isHttps);
    return urls.map((url, index) => ({
      id: `p:${product.id}:${index}`,
      label: urls.length > 1 ? `${product.name} (${index + 1}/${urls.length})` : product.name,
      url,
    }));
  });
}

/**
 * Image-library items (`media` training items) whose title or trigger shares a meaningful word
 * with the customer's text, ids `m:<itemId>`.
 */
export function libraryImages(
  items: readonly {
    id: string;
    kind: string;
    title: string;
    trigger: string;
    mediaUrl: string | null;
  }[],
  query: string,
): AllowedImage[] {
  const asked = new Set(words(query));
  if (!asked.size) return [];
  return items.flatMap((item) => {
    if (item.kind !== 'media' || !item.mediaUrl || !isHttps(item.mediaUrl)) return [];
    const matched = words(`${item.title} ${item.trigger}`).some((word) => asked.has(word));
    return matched
      ? [{ id: `m:${item.id}`, label: item.title.slice(0, 120), url: item.mediaUrl }]
      : [];
  });
}

/** Library matches first (the owner picked them), then product pictures; unique ids, max 10. */
export function buildAllowlist(
  products: readonly AllowedImage[],
  library: readonly AllowedImage[],
): AllowedImage[] {
  const seen = new Set<string>();
  return [...library, ...products]
    .filter((image) => !seen.has(image.id) && Boolean(seen.add(image.id)))
    .slice(0, MAX_ALLOWED_IMAGES);
}

/** The compact block for the model: id and label only, never a URL. */
export function imagesBlock(allowed: readonly AllowedImage[]): string {
  if (!allowed.length) return '';
  const lines = allowed.map((image) => `${image.id}: ${image.label.replace(/\s+/g, ' ')}`);
  return `Images you may send (id: label):\n${lines.join('\n')}`;
}

/**
 * Resolves the ids the model asked for. Ids outside the allowlist (invented, URL-looking, from
 * another turn) are dropped, duplicates collapse, at most 3 remain, in the order requested.
 */
export function resolveImageIds(
  ids: readonly string[] | undefined,
  allowed: readonly AllowedImage[],
): { url: string; label: string }[] {
  const byId = new Map(allowed.map((image) => [image.id, image]));
  const seen = new Set<string>();
  const out: { url: string; label: string }[] = [];
  for (const raw of ids ?? []) {
    const image = typeof raw === 'string' ? byId.get(raw.trim()) : undefined;
    if (!image || seen.has(image.id)) continue;
    seen.add(image.id);
    out.push({ url: image.url, label: image.label });
    if (out.length === MAX_SENT_IMAGES) break;
  }
  return out;
}
