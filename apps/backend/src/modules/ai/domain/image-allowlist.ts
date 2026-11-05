import { BOT_ALBUM_PAGE_SIZE, isLodgingVideoPath, isMediaPath } from '@agent-sales/contracts';
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

/**
 * A picture a channel can receive once made absolute: an https link or a stored Rapiz `/media/<key>`
 * path (the application rebuilds it on the current public base before sending).
 */
const isSendable = (value: string): boolean => isHttps(value) || isMediaPath(value);

/** A sendable picture: never a stored lodging video (`isMediaPath` also accepts those). */
const isSendableImage = (value: string): boolean => isSendable(value) && !isLodgingVideoPath(value);

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

/** Most pictures listed per product. */
export const MAX_PRODUCT_IMAGES = 5;
/** Lodging galleries are listed whole (up to this many), so any photo can be requested. */
export const MAX_GALLERY_IMAGES = 15;

/** Lodging folders and videos listed per product (T-192). */
export const MAX_PRODUCT_ALBUMS = 20;
export const MAX_PRODUCT_VIDEOS = 10;

/** A lodging folder the model may send page by page (`send_message` `albumId`). */
export interface AllowedAlbum {
  id: string;
  label: string;
  images: { url: string; label: string }[];
}

/** A lodging video (sent as a video) or video link (sent as text) (`send_message` `videoId`). */
export interface AllowedVideo {
  id: string;
  label: string;
  kind: 'video' | 'link';
  url: string;
  /** The caption, or "video N" (N = its place among the folder's videos). */
  title: string;
}

type MediaFolders =
  | readonly {
      name: string;
      items: readonly { kind: string; url: string; caption: string }[];
    }[]
  | undefined;

interface MediaProduct {
  id: string;
  name: string;
  accommodation?:
    | {
        albums?: MediaFolders;
        /** Units with their own folders (T-193). */
        units?: readonly { name: string; albums?: MediaFolders }[] | undefined;
      }
    | null
    | undefined;
}

/** Folders of all units of one product (after the property's own, T-193). */
export const MAX_UNIT_ALBUMS = 40;
export const MAX_UNIT_VIDEOS = 20;

/**
 * The folders of a product with their id index: the property's own at 0..19, then its units'
 * folders from MAX_PRODUCT_ALBUMS on (labelled with the unit name, `unit` = "<unit> – "), so a
 * unit folder never shifts a property folder id.
 */
const albumsOf = (product: MediaProduct) => [
  ...(product.accommodation?.albums ?? [])
    .slice(0, MAX_PRODUCT_ALBUMS)
    .map((folder, f) => ({ f, unit: '', name: folder.name, items: folder.items })),
  ...(product.accommodation?.units ?? [])
    .flatMap((unit) =>
      (unit.albums ?? []).map((folder) => ({
        unit: `${unit.name} – `,
        name: folder.name,
        items: folder.items,
      })),
    )
    .slice(0, MAX_UNIT_ALBUMS)
    .map((folder, k) => ({ f: MAX_PRODUCT_ALBUMS + k, ...folder })),
];

/**
 * The folders of lodging products, ids `a:<productId>:<folderIndex>`, each with its sendable
 * photos in the owner's order. Folders without a sendable photo are not albums.
 */
export function productAlbums(products: readonly MediaProduct[]): AllowedAlbum[] {
  return products.flatMap((product) =>
    albumsOf(product).flatMap(({ f, ...folder }) => {
      const images = folder.items
        .filter((item) => item.kind === 'image' && isSendableImage(item.url))
        .map((item) => ({
          url: item.url,
          label: `${product.name} – ${folder.unit}${item.caption.trim() || folder.name}`,
        }));
      return images.length
        ? [
            {
              id: `a:${product.id}:${f}`,
              label: `${product.name} – ${folder.unit}${folder.name} (${images.length} ảnh)`,
              images,
            },
          ]
        : [];
    }),
  );
}

/** Uploaded videos and video links of lodging products, ids `v:<productId>:<folder>:<item>`. */
export function productVideos(products: readonly MediaProduct[]): AllowedVideo[] {
  return products.flatMap((product) => {
    const videos = albumsOf(product).flatMap(({ f, ...folder }) => {
      let n = 0;
      return folder.items.flatMap((item, i): AllowedVideo[] => {
        if (item.kind !== 'video' && item.kind !== 'link') return [];
        n += 1;
        const ok = item.kind === 'video' ? isSendable(item.url) : isHttps(item.url);
        const title = item.caption.trim() || `video ${n}`;
        return ok
          ? [
              {
                id: `v:${product.id}:${f}:${i}`,
                label: `${product.name} – ${folder.unit}${folder.name} – video: ${title}`,
                kind: item.kind,
                url: item.url,
                title,
              },
            ]
          : [];
      });
    });
    // At most 10 of the property's own, then at most 20 of its units'.
    const own = (v: AllowedVideo) => Number(v.id.split(':')[2]) < MAX_PRODUCT_ALBUMS;
    return [
      ...videos.filter(own).slice(0, MAX_PRODUCT_VIDEOS),
      ...videos.filter((v) => !own(v)).slice(0, MAX_UNIT_VIDEOS),
    ];
  });
}

/**
 * The next page of a folder (spec D3): the first `size` photos not sent yet, in order; when every
 * photo was sent, it starts again from the first. `remaining` = photos still unsent after it.
 */
export function nextAlbumPage(
  sent: readonly boolean[],
  size = BOT_ALBUM_PAGE_SIZE,
): { indexes: number[]; remaining: number; restarted: boolean } {
  const unsent = sent.flatMap((was, i) => (was ? [] : [i]));
  const restarted = unsent.length === 0;
  const pool = restarted ? sent.map((_, i) => i) : unsent;
  const indexes = pool.slice(0, size);
  return { indexes, remaining: pool.length - indexes.length, restarted };
}

/**
 * The pictures of the products whose details the model received, ids `p:<productId>:<index>`, at
 * most 5 per product and independent of the customer's text (the model picks which to send).
 * Lodging galleries are listed whole (max 15). Anything that is not an https URL or a Rapiz
 * `/media/` path is dropped even though the API already validates it.
 */
export function productImages(
  products: readonly {
    id: string;
    name: string;
    imageUrls?: readonly string[];
    accommodation?: { gallery: readonly { url: string; caption: string }[] } | null | undefined;
  }[],
): AllowedImage[] {
  return products.flatMap((product) => {
    if (product.accommodation) {
      return product.accommodation.gallery.slice(0, MAX_GALLERY_IMAGES).flatMap((photo, index) =>
        isSendableImage(photo.url)
          ? [
              {
                id: `p:${product.id}:${index}`,
                label: `${product.name} – ${photo.caption}`,
                url: photo.url,
              },
            ]
          : [],
      );
    }
    const urls = (product.imageUrls ?? []).filter(isSendableImage).slice(0, MAX_PRODUCT_IMAGES);
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
  return items
    .flatMap((item) => {
      if (item.kind !== 'media' || !item.mediaUrl || !isSendableImage(item.mediaUrl)) return [];
      const matched = new Set(
        words(`${item.title} ${item.trigger}`).filter((word) => asked.has(word)),
      ).size;
      return matched
        ? [
            {
              image: { id: `m:${item.id}`, label: item.title.slice(0, 120), url: item.mediaUrl },
              score: matched,
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.image);
}

/** Library matches first (the owner picked them), then product pictures; unique ids, max `max` (default 10). */
export function buildAllowlist(
  products: readonly AllowedImage[],
  library: readonly AllowedImage[],
  query = '',
  max = MAX_ALLOWED_IMAGES,
): AllowedImage[] {
  const asked = new Set(words(query));
  const score = (image: AllowedImage) =>
    new Set(words(image.label).filter((word) => asked.has(word))).size;
  const ranked = [...library, ...products];
  if (asked.size) ranked.sort((a, b) => score(b) - score(a));
  const seen = new Set<string>();
  return ranked.filter((image) => !seen.has(image.id) && Boolean(seen.add(image.id))).slice(0, max);
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
export function selectImages(
  ids: readonly string[] | undefined,
  allowed: readonly AllowedImage[],
): AllowedImage[] {
  const byId = new Map(allowed.map((image) => [image.id, image]));
  const seen = new Set<string>();
  const out: AllowedImage[] = [];
  for (const raw of ids ?? []) {
    const image = typeof raw === 'string' ? byId.get(raw.trim()) : undefined;
    if (!image || seen.has(image.id)) continue;
    seen.add(image.id);
    out.push(image);
    if (out.length === MAX_SENT_IMAGES) break;
  }
  return out;
}

export function resolveImageIds(
  ids: readonly string[] | undefined,
  allowed: readonly AllowedImage[],
): { url: string; label: string }[] {
  return selectImages(ids, allowed).map(({ url, label }) => ({ url, label }));
}

/**
 * The product id inside a product image id (`p:<productId>:<index>`), an album photo id
 * (`a:<productId>:<folder>:<index>`), an album id (`a:<productId>:<folder>`) or a video id
 * (`v:<productId>:<folder>:<item>`); null for library images.
 */
export function productIdOfImage(imageId: string): string | null {
  const m = /^p:(.+):\d+$/.exec(imageId) ?? /^[av]:([^:]+):\d+(?::\d+)?$/.exec(imageId);
  return m?.[1] ?? null;
}
