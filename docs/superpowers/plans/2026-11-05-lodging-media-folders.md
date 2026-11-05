# Lodging Media Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 30-photo lodging gallery with Drive-like folders of photos, uploaded MP4 videos (≤ 25 MB) and video links, and let the hotel bot send a folder in pages of 8 photos (plus one video or link on request).

**Architecture:** The `lodging_properties.gallery` JSONB keeps its column but holds `GalleryFolder[]` (migration 0066 back-fills old rows into one "Ảnh chung" folder) plus a new `gallery_cover` column. Lodging gets its own MP4 upload route (`POST /lodging/media/videos`, own `S3PublicObjectStorage`, 120 s put timeout). The bot product carries `accommodation.albums`; the ai module lists album / video ids next to image ids, and `send_message` gains `albumId` (next 8 photos the conversation has not received, using bot attachment URLs the conversation module passes in `ReplyOptions.sentMediaUrls`) and `videoId`. Conversation delivery raises the album cap to 8 and sends a video as its own message through a typed `commitBotAttachments`. The web "Ảnh & video" tab becomes a folder list + folder view with numbered, sortable tiles (`@dnd-kit`).

**Tech Stack:** TypeScript, Zod 4 (`packages/contracts`), Drizzle + hand-written SQL migrations (`packages/db`), NestJS on Fastify with `@fastify/multipart` 10, AWS SDK v3 S3 client, Vitest + Testcontainers, React 19 + TanStack Router/Query + shadcn/ui + Testing Library, `@dnd-kit/core` 6.3.1 / `@dnd-kit/sortable` 10.0.0 / `@dnd-kit/utilities` 3.2.2.

**Spec:** `docs/superpowers/specs/2026-11-05-lodging-media-folders-design.md` (read it fully before starting any task).

## Global Constraints

- English for code, identifiers, comments, commits, tests and technical docs; Vietnamese only in i18n `vi` strings, stored business defaults (the folder name `Ảnh chung`) and model-facing labels that already follow the existing Vietnamese pattern (`[Khách đã gửi kèm…]`, `(N ảnh)`).
- `pnpm check` (lint + arch + typecheck + test + build) must pass at the end (Task 12). Never skip, delete or weaken a test or a lint rule.
- Module boundaries: `lodging` must never import `commerce` (or any other tier-2 module); `ai` must never import `conversation` (conversation depends on ai); web features never import each other — compose in `routes/`.
- Every new route is declared in `packages/contracts/src/<module>/<module>.routes.ts` with an `assistant` ruling (uploads are `use: 'never'`); `apps/backend/test/http.spec.ts` checks served vs declared routes.
- Migrations are forward-only: never edit an applied file; the next file is `packages/db/migrations/0066_lodging_media_folders.sql`.
- Conventional Commits; scopes must come from `commitlint.config.js` (`lodging` and `contracts` are NOT allowed scopes): use `api` (contracts), `db`, `backend`, `ai`, `conversation`, `web`, `i18n`, or no scope for docs. Header ≤ 100 chars, body lines ≤ 100 chars.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pictures stay JPEG/PNG (Messenger rejects WebP inside albums): images keep going through `resizeImage` → `POST /products/images`.
- Limits (copy exactly): 20 folders per property, 200 items per property (all folders together), caption ≤ 300 chars, folder name 1–100 chars, folder id 1–40 chars `[A-Za-z0-9_-]`, link ≤ 2000 chars and `https:` only, video ≤ 25 MiB (`25 * 1024 * 1024` bytes) MP4 only, bot album page = 8 photos, at most 20 albums and 10 videos per product in the bot allowlist, flat image list for single photos max 15, `imageIds` ≤ 3 per `send_message`.
- `packages/contracts` and `packages/db` are consumed through their `dist/`: after changing either, run `pnpm --filter @agent-sales/contracts build` / `pnpm --filter @agent-sales/db build` before running backend or web tests.
- Between Task 1 and Task 3 (backend) and between Task 1 and Task 10 (web) `pnpm typecheck` fails in the files those tasks rewrite; each task runs its own Vitest commands, and the branch is squash-merged. Do not "fix" those files early in another task.

---

## File Structure

**Contracts (`packages/contracts/src`)**
- `common/media.ts` (modify) — `MEDIA_PATH` gains `lodging/<ws>/<uuid>.mp4`; new `isLodgingVideoPath`, `LodgingVideoPath`, `PublicHttpsUrl`; `PublicImageUrl` refuses video paths.
- `lodging/gallery.ts` (create) — gallery limits, `GalleryItem`, `GalleryFolder`, `Gallery`, `galleryCoverUrl`, `hasGalleryImage`, `UploadLodgingVideoResponse`, `BOT_ALBUM_PAGE_SIZE`, `LODGING_VIDEO_MAX_BYTES`.
- `lodging/lodging.schema.ts` (modify) — `gallery` = `Gallery`, new `galleryCover`, cover refinement on `PropertyInput`; `GalleryImage` removed.
- `lodging/lodging.routes.ts` (modify) — `POST /lodging/media/videos`.
- `commerce/lodging.schema.ts` (modify) — `AccommodationDetails.albums` (optional).
- `ai/ai.schema.ts` (modify, Task 6) — `PlaygroundRequest.sentMediaUrls`, `PlaygroundResponse.messages[].videos`.
- `index.ts` (modify) — export `lodging/gallery.js`.

**DB (`packages/db`)**
- `src/schema/lodging.ts` (modify) — folder JSON type for `gallery`, column `galleryCover`.
- `migrations/0066_lodging_media_folders.sql` (create).
- `src/lodging-media-folders.integration.test.ts` (create).

**Backend (`apps/backend/src`)**
- `common/storage/public-object-storage.ts` (modify) — configurable `requestTimeoutMs`.
- `modules/lodging/application/ports/lodging-store.ts` (modify) — `PropertyRecord.gallery: GalleryFolder[]`, `galleryCover`.
- `modules/lodging/infrastructure/persistence/lodging.rows.ts` (modify) — `toGallery` (legacy tolerant), cover mapping.
- `modules/lodging/application/property.service.ts` (modify) — `fieldsOf`, `assertOwnGallery` for folders and videos.
- `modules/lodging/application/bot-product.ts` (modify) — albums, flattened gallery, cover-first `imageUrls`.
- `modules/lodging/domain/mp4.ts` (create) — `isMp4` ftyp sniff.
- `modules/lodging/application/ports/lodging-media-storage.ts` (create) — `LODGING_MEDIA_STORAGE`.
- `modules/lodging/application/lodging-media.service.ts` (create) — `LodgingMediaService.uploadVideo`.
- `modules/lodging/interface/http/lodging-media.controller.ts` (create).
- `modules/lodging/lodging.module.ts` (modify) — storage provider, service, controller.
- `modules/ai/domain/image-allowlist.ts` (modify) — `AllowedAlbum`, `AllowedVideo`, `productAlbums`, `productVideos`, `nextAlbumPage`, `productIdOfImage` for `a:`/`v:` ids.
- `modules/ai/domain/catalog-context.ts` (modify) — albums summary.
- `modules/ai/domain/product-view.ts` (modify) — `albums` / `videos` id lists in product details.
- `modules/ai/api/reply-options.ts` (modify) — `OutgoingMessage.videos`, `ReplyOptions.sentMediaUrls`.
- `modules/ai/application/output-tools.ts` (modify) — allowlist albums/videos, `send_message` `albumId` / `videoId`, paging.
- `modules/ai/application/reply-pipeline.ts` (modify) — `turnTools` forwards `sentMediaUrls`, `addProducts`.
- `modules/ai/application/playground.service.ts` (modify) — focus media, carry, `sentMediaUrls`, prompt @20.
- `modules/ai/application/trace-detail.ts` (modify) — album / video detail.
- `modules/ai/evals/case.ts`, `evals/runner.ts` (modify) — `sent_media`.
- `cli/eval.ts` (modify) — prompt version 20.
- `modules/conversation/api/conversation.facade.ts`, `application/conversation.facade.impl.ts` (modify) — `commitBotAttachments` replaces `commitBotImages`.
- `modules/conversation/application/jobs/reply-delivery.ts` (modify) — album cap 8, video message.
- `modules/conversation/application/jobs/reply-turns.ts` (modify) — bot attachment note, `sentBotMediaUrls`.
- `modules/conversation/application/jobs/meta-inbox.processor.ts` (modify) — passes `sentMediaUrls`.
- `packages/ai-core/prompts/sales-agent@20.md` (create).
- `apps/backend/evals/lodging/hotel-a17-album-first-page.yaml`, `hotel-a17-album-next-page.yaml` (create).
- `apps/backend/test/lodging-media-http.spec.ts` (create).

**Web (`apps/web/src`)**
- `lib/api-client.ts` (modify) — `apiUpload` (XHR, progress, refresh-and-retry).
- `features/lodging/api/media.ts` (create) — `useUploadLodgingVideo`, `videoUploadErrorKey`.
- `features/lodging/lib/gallery-model.ts` (create) — pure draft operations.
- `features/lodging/hooks/use-media-upload.ts` (create) — per-file upload queue with progress.
- `features/lodging/components/gallery/text-dialog.tsx`, `link-dialog.tsx`, `move-dialog.tsx`, `media-tile.tsx`, `folder-list.tsx`, `folder-view.tsx` (create).
- `features/lodging/components/gallery-tab.tsx` (rewrite); `gallery-editor.tsx` + `gallery-editor.test.tsx` (delete).
- `features/lodging/components/property-editor.tsx` (modify) — new props, blocker ignores search-only navigation.
- `routes/app/properties/$propertyId.tsx` (modify) — `folder` search param, image upload function.
- `features/lodging/components/properties-page.tsx`, `properties-table.tsx` (modify) — `galleryCoverUrl`.
- `features/ai/api/playground.ts`, `features/ai/components/test-chat.tsx`, `test-chat-images.tsx` (modify) — videos, `sentMediaUrls`.
- `packages/i18n/src/messages/{vi,en}/common.json` (modify) — `lodging.media.*`, tab label.

**Docs**
- `docs/adr/ADR-026-lodging-media-folders.md` (create), `docs/adr/README.md`, `docs/adr/ADR-015-*.md` (note), `docs/lodging.md`, `docs/06-ai-engine.md`, `docs/05-data-model.md`, `docs/meta-inbox.md`, `docs/02-functional-requirements.md`, `docs/10-operations-and-deployment.md`, `apps/backend/evals/README.md`, module `MODULE.md` of lodging / ai / conversation / commerce.

---

### Task 1: Contracts — media paths, gallery folders, cover, albums, video upload route

**Files:**
- Modify: `packages/contracts/src/common/media.ts:8-41`
- Create: `packages/contracts/src/lodging/gallery.ts`
- Create: `packages/contracts/src/lodging/gallery.test.ts`
- Modify: `packages/contracts/src/common/media.test.ts` (append a `describe`)
- Modify: `packages/contracts/src/lodging/lodging.schema.ts:1-3, 65-69, 95, 116, 126-130`
- Modify: `packages/contracts/src/lodging/lodging.schema.test.ts:9, 81-92, 187`
- Modify: `packages/contracts/src/lodging/lodging.routes.ts:1-29, 33-210` (one route appended)
- Modify: `packages/contracts/src/commerce/lodging.schema.ts:1-3, 55`
- Modify: `packages/contracts/src/index.ts:46-48`

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `@agent-sales/contracts`):
  - `isLodgingVideoPath(value: string): boolean`; `LodgingVideoPath: z.ZodString`; `PublicHttpsUrl: z.ZodString`; `PublicImageUrl` now rejects `/media/lodging/…mp4`.
  - `GALLERY_MAX_FOLDERS = 20`, `GALLERY_MAX_ITEMS = 200`, `BOT_ALBUM_PAGE_SIZE = 8`, `LODGING_VIDEO_MAX_BYTES = 26_214_400`.
  - `GalleryItem` (discriminated on `kind: 'image' | 'video' | 'link'`, `{ kind, url, caption }`), `type GalleryItem`, `type GalleryItemKind`.
  - `GalleryFolderId`, `GalleryFolder` (`{ id, name, items }`), `type GalleryFolder`, `Gallery` (array schema with total/unique checks), `folderNameKey(name: string): string`.
  - `galleryCoverUrl(p: { gallery: readonly { items: readonly { kind: string; url: string }[] }[]; galleryCover: string }): string | null`.
  - `hasGalleryImage(gallery: readonly { items: readonly { kind: string; url: string }[] }[], url: string): boolean`.
  - `UploadLodgingVideoResponse` (`{ url: LodgingVideoPath, bytes: int }`), `type UploadLodgingVideoResponse`.
  - `PropertyDto.gallery: GalleryFolder[]`, `PropertyDto.galleryCover: string` (also on `PropertySummary`, `PropertyInput`, `PropertyPatchFields`).
  - `AccommodationDetails.albums?: GalleryFolder[]` (≤ 20).
  - Route `POST /lodging/media/videos` in `lodgingV2Routes`.

- [ ] **Step 1: Write the failing media-path tests**

Append to `packages/contracts/src/common/media.test.ts` (and extend its import to `import { isLodgingVideoPath, isMediaPath, LodgingVideoPath, PublicHttpsUrl, PublicImageUrl } from './media.js';`):

```ts
describe('lodging video paths', () => {
  const video = `/media/lodging/${WS}/${F}.mp4`;
  it('accepts the lodging mp4 key shape as Rapiz media', () => {
    expect(isMediaPath(video)).toBe(true);
    expect(isLodgingVideoPath(video)).toBe(true);
    expect(LodgingVideoPath.safeParse(video).success).toBe(true);
  });
  it('rejects look-alike video paths', () => {
    for (const bad of [
      `/media/lodging/${WS}/${F}.mov`,
      `/media/lodging/${WS}/clip.mp4`,
      `/media/lodging/shop/${F}.mp4`,
      `/media/products/${WS}/${F}.mp4`,
      `/media/lodging/${WS}/${F}.mp4?x=1`,
      `/media/lodging/${WS}/../${F}.mp4`,
      `https://cdn.example.com/media/lodging/${WS}/${F}.mp4`,
    ])
      expect(isLodgingVideoPath(bad), bad).toBe(false);
    expect(LodgingVideoPath.safeParse('https://youtu.be/abc').success).toBe(false);
  });
  it('keeps videos out of PublicImageUrl', () => {
    expect(PublicImageUrl.safeParse(video).success).toBe(false);
  });
  it('PublicHttpsUrl accepts https only', () => {
    expect(PublicHttpsUrl.safeParse('https://youtu.be/abc').success).toBe(true);
    for (const bad of ['http://youtu.be/abc', 'javascript:alert(1)', 'data:text/html,x', '/media/x'])
      expect(PublicHttpsUrl.safeParse(bad).success, bad).toBe(false);
    expect(PublicHttpsUrl.safeParse(`https://x.vn/${'a'.repeat(2000)}`).success).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing gallery tests**

Create `packages/contracts/src/lodging/gallery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { AccommodationDetails } from '../commerce/lodging.schema.js';
import {
  Gallery,
  GALLERY_MAX_ITEMS,
  GalleryFolder,
  GalleryItem,
  galleryCoverUrl,
  hasGalleryImage,
  UploadLodgingVideoResponse,
} from './gallery.js';
import { PropertyInput, UpdatePropertyRequest } from './lodging.schema.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const F = '0192f0a0-0000-7000-8000-0000000000aa';
const IMG = `/media/products/${WS}/${F}.jpg`;
const VIDEO = `/media/lodging/${WS}/${F}.mp4`;
const folder = (id: string, name: string, items: unknown[] = []) => ({ id, name, items });
const image = (url = IMG, caption?: string) => ({ kind: 'image', url, ...(caption ? { caption } : {}) });

describe('GalleryItem', () => {
  it('accepts an image, an uploaded video and an https link, captions optional', () => {
    expect(GalleryItem.parse(image())).toEqual({ kind: 'image', url: IMG, caption: '' });
    expect(GalleryItem.parse({ kind: 'video', url: VIDEO }).kind).toBe('video');
    expect(GalleryItem.parse({ kind: 'link', url: 'https://youtu.be/x', caption: 'Tour' })).toEqual({
      kind: 'link',
      url: 'https://youtu.be/x',
      caption: 'Tour',
    });
  });
  it('refuses an external video, a video as an image and a non-https link', () => {
    expect(GalleryItem.safeParse({ kind: 'video', url: 'https://youtu.be/x' }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'image', url: VIDEO }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'link', url: 'http://youtu.be/x' }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'link', url: 'javascript:alert(1)' }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'image', url: IMG, caption: 'x'.repeat(301) }).success).toBe(
      false,
    );
  });
});

describe('GalleryFolder and Gallery', () => {
  it('trims names and checks ids', () => {
    expect(GalleryFolder.parse(folder('f-1', '  Phòng ngủ  ')).name).toBe('Phòng ngủ');
    expect(GalleryFolder.safeParse(folder('f 1', 'A')).success).toBe(false);
    expect(GalleryFolder.safeParse(folder('x'.repeat(41), 'A')).success).toBe(false);
    expect(GalleryFolder.safeParse(folder('f1', '   ')).success).toBe(false);
  });
  it('allows at most 20 folders and 200 items in all', () => {
    const many = Array.from({ length: 21 }, (_, i) => folder(`f${i}`, `F${i}`));
    expect(Gallery.safeParse(many).success).toBe(false);
    const full = [
      folder('a', 'A', Array.from({ length: 150 }, () => image())),
      folder('b', 'B', Array.from({ length: GALLERY_MAX_ITEMS - 150 }, () => image())),
    ];
    expect(Gallery.safeParse(full).success).toBe(true);
    full[1]!.items.push(image());
    expect(Gallery.safeParse(full).success).toBe(false);
  });
  it('refuses duplicate folder ids and duplicate names ignoring case', () => {
    expect(Gallery.safeParse([folder('a', 'A'), folder('a', 'B')]).success).toBe(false);
    expect(Gallery.safeParse([folder('a', 'Phòng Ngủ'), folder('b', ' phòng ngủ ')]).success).toBe(
      false,
    );
  });
});

describe('galleryCoverUrl', () => {
  const gallery = Gallery.parse([
    folder('v', 'Video', [{ kind: 'video', url: VIDEO }]),
    folder('r', 'Phòng', [image(`https://cdn.example.com/1.jpg`), image(`https://cdn.example.com/2.jpg`)]),
  ]);
  it('uses the chosen cover, else the first image of the first folder that has one', () => {
    expect(galleryCoverUrl({ gallery, galleryCover: '' })).toBe('https://cdn.example.com/1.jpg');
    expect(galleryCoverUrl({ gallery, galleryCover: 'https://cdn.example.com/2.jpg' })).toBe(
      'https://cdn.example.com/2.jpg',
    );
    expect(galleryCoverUrl({ gallery: [], galleryCover: '' })).toBeNull();
    expect(hasGalleryImage(gallery, VIDEO)).toBe(false);
  });
});

describe('property gallery fields', () => {
  const base = { code: 'A17', name: 'Villa', sellMode: 'whole', standardAdults: 2, standardChildren: 0 };
  it('defaults to no folders and an automatic cover', () => {
    const parsed = PropertyInput.parse(base);
    expect(parsed.gallery).toEqual([]);
    expect(parsed.galleryCover).toBe('');
  });
  it('requires the cover to be an image of the gallery', () => {
    const gallery = [folder('r', 'Phòng', [image()])];
    expect(PropertyInput.safeParse({ ...base, gallery, galleryCover: IMG }).success).toBe(true);
    expect(PropertyInput.safeParse({ ...base, gallery, galleryCover: 'https://x.vn/a.jpg' }).success).toBe(
      false,
    );
  });
  it('keeps PATCH partial: a lone galleryCover stays a lone field', () => {
    expect(UpdatePropertyRequest.parse({ version: 1, patch: { galleryCover: '' } }).patch).toEqual({
      galleryCover: '',
    });
  });
});

describe('bot albums and video upload response', () => {
  it('parses an accommodation with and without albums', () => {
    const acc = {
      rentalType: 'entire_property',
      bedrooms: 1,
      standardAdults: 2,
      standardChildren: 0,
      childAgeBelow: 6,
      maxGuests: null,
      roomLayout: [{ name: 'Room', beds: 'One bed' }],
      amenities: [],
      rateBasis: 'night',
      rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1 }],
      gallery: [],
    };
    expect(AccommodationDetails.parse(acc).albums).toBeUndefined();
    const withAlbums = AccommodationDetails.parse({
      ...acc,
      albums: [folder('r', 'Phòng', [image()])],
    });
    expect(withAlbums.albums?.[0]?.items[0]).toEqual({ kind: 'image', url: IMG, caption: '' });
  });
  it('answers the stored path and size of an uploaded video', () => {
    expect(UploadLodgingVideoResponse.parse({ url: VIDEO, bytes: 1024 })).toEqual({
      url: VIDEO,
      bytes: 1024,
    });
    expect(UploadLodgingVideoResponse.safeParse({ url: IMG, bytes: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/contracts exec vitest run src/common/media.test.ts src/lodging/gallery.test.ts`
Expected: FAIL — `isLodgingVideoPath` / `./gallery.js` cannot be resolved.

- [ ] **Step 4: Implement the media paths**

In `packages/contracts/src/common/media.ts` replace lines 9–21 (the key-shape comment and `MEDIA_PATH`) and lines 36–41 (`PublicImageUrl`) with:

```ts
/**
 * Exactly the keys Rapiz generates (uuid workspace, uuid file name), so a look-alike external URL
 * such as `https://cdn.shop.vn/media/products/villa-1.jpg` is never mistaken for ours:
 * product pictures `products/<ws>/<id>.jpg|png`, bot library images
 * `workspaces/<ws>/bots/<bot>/<id>.jpg|png|webp`, website chat uploads
 * `webchat/<ws>/<connection>/<id>.jpg|png|webp|gif`, lodging videos `lodging/<ws>/<id>.mp4`.
 */
const MEDIA_PATH = new RegExp(
  `^/media/(?:products/${UUID}/${UUID}\\.(?:jpe?g|png)` +
    `|workspaces/${UUID}/bots/${UUID}/${UUID}\\.(?:jpe?g|png|webp)` +
    `|webchat/${UUID}/${UUID}/${UUID}\\.(?:jpe?g|png|webp|gif)` +
    `|lodging/${UUID}/${UUID}\\.mp4)$`,
  'i',
);
const LODGING_VIDEO_PATH = new RegExp(`^/media/lodging/${UUID}/${UUID}\\.mp4$`, 'i');
```

keep `isMediaPath` and `isHttpsUrl` as they are, then add after `isMediaPath`:

```ts
/** True for the `/media/lodging/<ws>/<id>.mp4` path of a video uploaded to a lodging gallery. */
export function isLodgingVideoPath(value: string): boolean {
  return LODGING_VIDEO_PATH.test(value);
}
```

and replace `PublicImageUrl` with:

```ts
/** A customer-facing picture: an https link or a stored Rapiz `/media/…` picture path (never a video). */
export const PublicImageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => (isHttpsUrl(v) || isMediaPath(v)) && !isLodgingVideoPath(v),
    'must be an https link or a /media/ picture path',
  );

/** An https link (no http:, javascript: or data:), e.g. a YouTube or Drive video link. */
export const PublicHttpsUrl = z.string().trim().max(2000).refine(isHttpsUrl, 'must be an https link');

/** A video uploaded through POST /lodging/media/videos, stored as its `/media/lodging/…` path. */
export const LodgingVideoPath = z
  .string()
  .trim()
  .max(2000)
  .refine(isLodgingVideoPath, 'must be a /media/lodging/ video path');
```

- [ ] **Step 5: Implement the gallery module**

Create `packages/contracts/src/lodging/gallery.ts`:

```ts
import { z } from 'zod';

import { LodgingVideoPath, PublicHttpsUrl, PublicImageUrl } from '../common/media.js';

/**
 * Lodging media folders (T-192, ADR-026): one level of folders per property, each holding photos,
 * uploaded MP4 videos and video links, in the owner's order. The bot sends a folder 8 photos at a
 * time (`BOT_ALBUM_PAGE_SIZE`).
 */
export const GALLERY_MAX_FOLDERS = 20;
/** Items of one property, every folder together. */
export const GALLERY_MAX_ITEMS = 200;
export const BOT_ALBUM_PAGE_SIZE = 8;
/** Largest MP4 the upload route accepts (Messenger's attachment limit is 25 MB too). */
export const LODGING_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

const Caption = z.string().trim().max(300).default('');

/** A photo (product picture path or https link), an uploaded video, or an https video link. */
export const GalleryItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), url: PublicImageUrl, caption: Caption }),
  z.object({ kind: z.literal('video'), url: LodgingVideoPath, caption: Caption }),
  z.object({ kind: z.literal('link'), url: PublicHttpsUrl, caption: Caption }),
]);
export type GalleryItem = z.infer<typeof GalleryItem>;
export type GalleryItemKind = GalleryItem['kind'];

export const GalleryFolderId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/);
export const GalleryFolder = z.object({
  id: GalleryFolderId,
  name: z.string().trim().min(1).max(100),
  items: z.array(GalleryItem).max(GALLERY_MAX_ITEMS),
});
export type GalleryFolder = z.infer<typeof GalleryFolder>;

/** Folder names compare trimmed and case-insensitively ("Phòng ngủ" = " phòng NGỦ "). */
export const folderNameKey = (name: string): string => name.trim().toLocaleLowerCase('vi');

/** A property's folders: at most 20, at most 200 items in all, unique ids and names. */
export const Gallery = z
  .array(GalleryFolder)
  .max(GALLERY_MAX_FOLDERS)
  .superRefine((folders, ctx) => {
    const total = folders.reduce((n, f) => n + f.items.length, 0);
    if (total > GALLERY_MAX_ITEMS)
      ctx.addIssue({ code: 'custom', message: `at most ${GALLERY_MAX_ITEMS} items in all folders` });
    const ids = new Set<string>();
    const names = new Set<string>();
    folders.forEach((f, i) => {
      if (ids.has(f.id))
        ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'folder ids must be unique' });
      if (names.has(folderNameKey(f.name)))
        ctx.addIssue({ code: 'custom', path: [i, 'name'], message: 'folder names must be unique' });
      ids.add(f.id);
      names.add(folderNameKey(f.name));
    });
  });

type MediaFolders = readonly { items: readonly { kind: string; url: string }[] }[];

/** True when `url` is the url of an image item of one of the folders. */
export function hasGalleryImage(gallery: MediaFolders, url: string): boolean {
  return gallery.some((f) => f.items.some((i) => i.kind === 'image' && i.url === url));
}

/**
 * The cover of a property: `galleryCover` when set, else the first image of the first folder that
 * has one; null without any image. Used by the web lists and the bot product.
 */
export function galleryCoverUrl(p: { gallery: MediaFolders; galleryCover: string }): string | null {
  if (p.galleryCover) return p.galleryCover;
  for (const folder of p.gallery) {
    const first = folder.items.find((i) => i.kind === 'image');
    if (first) return first.url;
  }
  return null;
}

/** Answer of POST /lodging/media/videos: the stored path and its size in bytes. */
export const UploadLodgingVideoResponse = z.object({
  url: LodgingVideoPath,
  bytes: z.number().int().positive().max(LODGING_VIDEO_MAX_BYTES),
});
export type UploadLodgingVideoResponse = z.infer<typeof UploadLodgingVideoResponse>;
```

- [ ] **Step 6: Use the gallery in the property schema**

In `packages/contracts/src/lodging/lodging.schema.ts`:
- Replace line 3 with `import { Gallery, hasGalleryImage } from './gallery.js';` (the `PublicImageUrl` import is no longer used).
- Delete lines 65–69 (`GalleryImage` and its comment).
- Replace line 95 (`gallery: z.array(GalleryImage).max(30),`) with:

```ts
  /** Media folders (T-192): photos, uploaded videos and video links, in the owner's order. */
  gallery: Gallery,
  /** '' = automatic (first image of the first folder that has one); else an image item's url. */
  galleryCover: z.string().trim().max(2000),
```

- Replace line 116 (`gallery: propertyShape.gallery.default([]),`) with:

```ts
  gallery: propertyShape.gallery.default([]),
  galleryCover: propertyShape.galleryCover.default(''),
```

- Replace the `PropertyInput` definition (lines 126–129) with:

```ts
export const PropertyInput = PropertyFields.refine(
  (v) => v.childFreeBelow <= v.childAdultFrom,
  'childFreeBelow must not exceed childAdultFrom',
).refine((v) => v.galleryCover === '' || hasGalleryImage(v.gallery, v.galleryCover), {
  message: 'galleryCover must be the url of an image in the gallery',
  path: ['galleryCover'],
});
```

- Update the PATCH comment (line 121) to read `A given \`policies\` / \`layout\` / \`gallery\` replaces the stored value as a whole; \`galleryCover\` is checked against the merged gallery.`

- [ ] **Step 7: Albums on the bot product, the route, the barrel**

In `packages/contracts/src/commerce/lodging.schema.ts` add after line 3 `import { GALLERY_MAX_FOLDERS, GalleryFolder } from '../lodging/gallery.js';` and after line 55 (`gallery: z.array(Image).max(30),`):

```ts
    /**
     * Lodging media folders (T-192): filled only by the lodging bot product; older commerce rows
     * have none. `gallery` keeps the flat photo list for them.
     */
    albums: z.array(GalleryFolder).max(GALLERY_MAX_FOLDERS).optional(),
```

In `packages/contracts/src/lodging/lodging.routes.ts` add `UploadLodgingVideoResponse` to a new import line `import { UploadLodgingVideoResponse } from './gallery.js';` and append to the `lodgingV2Routes` array, after the last entry (`PUT /lodging/bots/{botId}/properties`):

```ts
  {
    ...scoped,
    method: 'post',
    path: '/lodging/media/videos',
    assistant: { use: 'never' },
    summary: 'Upload an MP4 video (multipart field `file`, at most 25 MB) to Rapiz storage',
    responses: { 201: UploadLodgingVideoResponse },
  },
```

In `packages/contracts/src/index.ts` add after line 47 (`export * from './lodging/lodging.schema.js';`): `export * from './lodging/gallery.js';`.

- [ ] **Step 8: Update the old gallery test**

In `packages/contracts/src/lodging/lodging.schema.test.ts` remove `GalleryImage,` from the import (line 9) and delete the `describe('lodging v2 gallery images', …)` block (lines 81–92); its https / `/media/` / traversal / `http:` / `javascript:` cases are now covered by `gallery.test.ts` and `media.test.ts`. Leave the `gallery` at line 187 unchanged: it belongs to a commerce `AccommodationDetails` fixture, whose `gallery` keeps the flat `{url, caption}` shape.

- [ ] **Step 9: Run the tests to verify they pass, then build**

Run: `pnpm --filter @agent-sales/contracts exec vitest run && pnpm --filter @agent-sales/contracts typecheck && pnpm --filter @agent-sales/contracts build`
Expected: PASS (including `routes.assistant.test.ts` and `routes.test.ts`), typecheck clean, `dist/` rebuilt.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts
git commit -m "feat(api): lodging gallery folders, video paths and video upload route (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: DB — `gallery_cover` column and migration 0066 back-fill

**Files:**
- Modify: `packages/db/src/schema/lodging.ts:52-77`
- Create: `packages/db/migrations/0066_lodging_media_folders.sql`
- Create: `packages/db/src/lodging-media-folders.integration.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime.
- Produces: `schema.lodgingProperties.gallery: jsonb<LodgingGalleryFolderJson[]>`, `schema.lodgingProperties.galleryCover: text not null default ''`; exported types `LodgingGalleryItemJson = { kind: 'image' | 'video' | 'link'; url: string; caption?: string }`, `LodgingGalleryFolderJson = { id: string; name: string; items: LodgingGalleryItemJson[] }`.

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/lodging-media-folders.integration.test.ts`:

```ts
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { migrate, MIGRATIONS_DIR } from './migrate.js';

/** Migration 0066 (T-192): flat lodging galleries become one "Ảnh chung" folder. */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
const user = newId();
const ws = newId();
const flat = newId();
const empty = newId();
const foldered = newId();
const FOLDERS = [
  {
    id: 'bedrooms',
    name: 'Phòng ngủ',
    items: [{ kind: 'image', url: 'https://cdn.example.com/b/1.jpg', caption: '' }],
  },
];
const FLAT = Array.from({ length: 12 }, (_, i) =>
  i % 2 === 0
    ? { url: `https://cdn.example.com/a17/${i}.jpg`, caption: `Ảnh ${i}` }
    : { url: `https://cdn.example.com/a17/${i}.jpg` },
);

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

async function property(id: string, code: string, gallery: unknown): Promise<void> {
  await owner.db.execute(sql`insert into lodging_properties
      (id, workspace_id, code, name, sell_mode, standard_adults, gallery)
    values (${id}, ${ws}, ${code}, ${`Villa ${code}`}, 'whole', 2, ${JSON.stringify(gallery)}::jsonb)`);
}

async function stored(id: string): Promise<{ gallery: unknown; gallery_cover: string }> {
  const rows = await owner.db.execute<{ gallery: unknown; gallery_cover: string }>(
    sql`select gallery, gallery_cover from lodging_properties where id = ${id}`,
  );
  const row = rows[0];
  if (!row) throw new Error(`property ${id} not found`);
  return row;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0065_assistant_step_detail.sql'));
  await owner.db.execute(
    sql`insert into users (id, email, name) values (${user}, 'folders@example.test', 'Owner')`,
  );
  await owner.db.execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Villas', 'hotel', ${user})`);
  await property(flat, 'A17', FLAT);
  await property(empty, 'B01', []);
  await property(foldered, 'C01', FOLDERS);
  await migrate(pg.ownerUrl);
});
afterAll(async () => {
  await owner?.close();
  await pg?.stop();
});

describe('migration 0066 lodging media folders', () => {
  it('turns a flat 12-photo gallery into one "Ảnh chung" folder, in order', async () => {
    const row = await stored(flat);
    expect(row.gallery_cover).toBe('');
    const folders = row.gallery as { id: string; name: string; items: unknown[] }[];
    expect(folders).toHaveLength(1);
    expect(folders[0]?.name).toBe('Ảnh chung');
    expect(folders[0]?.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(folders[0]?.items).toEqual(
      FLAT.map((g) => ({ kind: 'image', url: g.url, caption: g.caption ?? '' })),
    );
  });

  it('keeps an empty gallery and a gallery that already has folders', async () => {
    expect((await stored(empty)).gallery).toEqual([]);
    expect((await stored(foldered)).gallery).toEqual(FOLDERS);
  });

  it('changes nothing when it runs again', async () => {
    const before = await Promise.all([flat, empty, foldered].map(stored));
    await owner.db.execute(
      sql`delete from schema_migrations where name = '0066_lodging_media_folders.sql'`,
    );
    const again = await migrate(pg.ownerUrl);
    expect(again.applied).toEqual(['0066_lodging_media_folders.sql']);
    expect(await Promise.all([flat, empty, foldered].map(stored))).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @agent-sales/db exec vitest run --config vitest.integration.config.ts src/lodging-media-folders.integration.test.ts`
Expected: FAIL — column `gallery_cover` does not exist (Docker must be running for Testcontainers).

- [ ] **Step 3: Write the migration**

Create `packages/db/migrations/0066_lodging_media_folders.sql`:

```sql
-- 0066_lodging_media_folders: lodging photos, videos and links in folders (T-192, ADR-026).
-- `lodging_properties.gallery` keeps its column; its JSON becomes
-- [{id, name, items: [{kind: 'image'|'video'|'link', url, caption}]}]. A flat [{url, caption}]
-- list becomes one folder "Ảnh chung" in the same order. Empty lists and rows that already hold
-- folders (an element with an `items` key) are left alone, so this file can run again safely.
-- `gallery_cover` '' = automatic (the first image of the first folder that has one).

ALTER TABLE lodging_properties ADD COLUMN IF NOT EXISTS gallery_cover text NOT NULL DEFAULT '';

UPDATE lodging_properties p
SET gallery = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid()::text,
  'name', 'Ảnh chung',
  'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'image',
      'url', g->>'url',
      'caption', coalesce(g->>'caption', '')
    ) ORDER BY ord)
    FROM jsonb_array_elements(p.gallery) WITH ORDINALITY AS e(g, ord)
    WHERE jsonb_typeof(g) = 'object' AND g ? 'url'
  ), '[]'::jsonb)
))
WHERE jsonb_typeof(p.gallery) = 'array'
  AND jsonb_array_length(p.gallery) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.gallery) AS e(g)
    WHERE jsonb_typeof(g) = 'object' AND g ? 'items'
  );
```

- [ ] **Step 4: Update the Drizzle schema**

In `packages/db/src/schema/lodging.ts` add after line 50 (`LodgingBookingSource` type):

```ts
/** One gallery entry (migration 0066): a product-picture path or https photo, a video, a link. */
export type LodgingGalleryItemJson = { kind: 'image' | 'video' | 'link'; url: string; caption?: string };
export type LodgingGalleryFolderJson = { id: string; name: string; items: LodgingGalleryItemJson[] };
```

and replace line 75 (`gallery: jsonb('gallery').$type<{ url: string; caption?: string }[]>().notNull().default([]),`) with:

```ts
    /** Media folders (0066). Rows copied later by `lodging_copy_accommodations()` may be flat. */
    gallery: jsonb('gallery').$type<LodgingGalleryFolderJson[]>().notNull().default([]),
    /** '' = automatic cover; else the url of an image item (0066). */
    galleryCover: text('gallery_cover').notNull().default(''),
```

Update the header comment of the file (line 24) to read `CHECK constraints live in the SQL migrations only (0041, 0042, 0043); 0066 reshapes \`gallery\` into folders.`

- [ ] **Step 5: Run the test to verify it passes, then build**

Run: `pnpm --filter @agent-sales/db exec vitest run --config vitest.integration.config.ts src/lodging-media-folders.integration.test.ts && pnpm --filter @agent-sales/db typecheck && pnpm --filter @agent-sales/db build`
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): lodging gallery folders and cover column, migration 0066 (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Lodging module — folder persistence, ownership checks, bot product albums

**Files:**
- Modify: `apps/backend/src/modules/lodging/application/ports/lodging-store.ts:1, 24`
- Modify: `apps/backend/src/modules/lodging/infrastructure/persistence/lodging.rows.ts:1-5, 46, 78`
- Modify: `apps/backend/src/modules/lodging/application/property.service.ts:41-76`
- Modify: `apps/backend/src/modules/lodging/application/bot-product.ts:1-12, 112-115, 135, 170`
- Modify (tests/fixtures): `apps/backend/src/modules/lodging/__tests__/lodging-media-paths.spec.ts` (rewrite), `apps/backend/src/modules/lodging/application/property.service.spec.ts:34-80`, `apps/backend/src/modules/lodging/application/bot-catalog.spec.ts:49-56, 154-157`, `apps/backend/src/modules/lodging/application/calendar.service.spec.ts:40`, `apps/backend/test/lodging-v2.integration.spec.ts:60`, `apps/backend/test/lodging-properties.integration.spec.ts` (one new `it`)

**Interfaces:**
- Consumes (Task 1): `GalleryFolder`, `GalleryItem`, `galleryCoverUrl` from `@agent-sales/contracts`; (Task 2) `schema.lodgingProperties.galleryCover`.
- Produces:
  - `PropertyRecord.gallery: GalleryFolder[]`, `PropertyRecord.galleryCover: string`.
  - `toGallery(raw: unknown): GalleryFolder[]`, `LEGACY_FOLDER_ID = 'legacy'`, `LEGACY_FOLDER_NAME = 'Ảnh chung'` (exported from `lodging.rows.ts`).
  - `assertOwnGallery` errors: `details.reason` `IMAGE_NOT_UPLOADED` or `VIDEO_NOT_UPLOADED`, `details.field` `gallery[<f>].items[<i>].url`.
  - `toBotProduct(...)` → `accommodation.albums` (only when the property has folders; items keep `kind`, `url`, trimmed `caption`), `accommodation.gallery` = every folder's images in order, max 30, caption = item caption or folder name, `imageUrls` = cover first, then the next gallery images, max 5, no duplicates.

- [ ] **Step 1: Write the failing persistence test**

Replace `apps/backend/src/modules/lodging/__tests__/lodging-media-paths.spec.ts` with:

```ts
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_FOLDER_NAME,
  propertyValues,
  toProperty,
} from '../infrastructure/persistence/lodging.rows.js';

const WS = '01890000-0000-7000-8000-000000000001';
const OLD = 'https://scholar-images-location-module.trycloudflare.com/media';
const key = `products/${WS}/01890000-0000-7000-8000-0000000000aa.jpg`;
const clip = `lodging/${WS}/01890000-0000-7000-8000-0000000000bb.mp4`;

const row = (gallery: unknown, galleryCover = '') =>
  ({
    id: '01890000-0000-7000-8000-000000000002',
    code: 'A17',
    name: 'Villa',
    area: '',
    address: '',
    description: '',
    sellMode: 'whole',
    status: 'active',
    standardAdults: 2,
    standardChildren: 0,
    maxGuests: null,
    childFreeBelow: 6,
    childAdultFrom: 12,
    amenities: [],
    layout: [],
    policies: {},
    gallery,
    galleryCover,
    internalNote: '',
    extraAdultSell: null,
    extraAdultCost: null,
    extraChildSell: null,
    extraChildCost: null,
    sortOrder: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Parameters<typeof toProperty>[0];

const folders = [
  {
    id: 'front',
    name: 'Mặt tiền',
    items: [
      { kind: 'image', url: `${OLD}/${key}`, caption: 'Mặt tiền' },
      { kind: 'image', url: 'https://img.example.com/a.jpg', caption: 'Link ngoài' },
      { kind: 'image', url: 'https://cdn.shop.vn/media/products/villa-1.jpg' },
      { kind: 'video', url: `${OLD}/${clip}`, caption: '' },
      { kind: 'link', url: 'https://youtu.be/abc', caption: 'Tour' },
    ],
  },
];

describe('lodging gallery folders as /media/ paths', () => {
  it('reads Rapiz photos and videos on a former tunnel host as their relative path', () => {
    const p = toProperty(row(folders, `${OLD}/${key}`));
    expect(p.gallery).toEqual([
      {
        id: 'front',
        name: 'Mặt tiền',
        items: [
          { kind: 'image', url: `/media/${key}`, caption: 'Mặt tiền' },
          { kind: 'image', url: 'https://img.example.com/a.jpg', caption: 'Link ngoài' },
          { kind: 'image', url: 'https://cdn.shop.vn/media/products/villa-1.jpg', caption: '' },
          { kind: 'video', url: `/media/${clip}`, caption: '' },
          { kind: 'link', url: 'https://youtu.be/abc', caption: 'Tour' },
        ],
      },
    ]);
    expect(p.galleryCover).toBe(`/media/${key}`);
  });

  it('reads a flat pre-0066 list as one "Ảnh chung" folder', () => {
    const p = toProperty(row([{ url: `${OLD}/${key}`, caption: 'Hồ bơi' }, { url: 'https://img.example.com/b.jpg' }]));
    expect(p.gallery).toEqual([
      {
        id: 'legacy',
        name: LEGACY_FOLDER_NAME,
        items: [
          { kind: 'image', url: `/media/${key}`, caption: 'Hồ bơi' },
          { kind: 'image', url: 'https://img.example.com/b.jpg', caption: '' },
        ],
      },
    ]);
    expect(toProperty(row([])).gallery).toEqual([]);
  });

  it('stores Rapiz media as its path, whatever host the editor sent, and links as they are', () => {
    const p = {
      ...toProperty(row([])),
      gallery: [
        {
          id: 'f',
          name: 'F',
          items: [
            { kind: 'image' as const, url: `https://other.test/media/${key}`, caption: '' },
            { kind: 'video' as const, url: `https://other.test/media/${clip}`, caption: '' },
            { kind: 'link' as const, url: 'https://youtu.be/abc', caption: '' },
          ],
        },
      ],
      galleryCover: `https://other.test/media/${key}`,
    };
    const values = propertyValues(workspaceId(WS), p);
    expect(values.gallery[0]?.items.map((i) => i.url)).toEqual([
      `/media/${key}`,
      `/media/${clip}`,
      'https://youtu.be/abc',
    ]);
    expect(values.galleryCover).toBe(`/media/${key}`);
  });
});
```

- [ ] **Step 2: Write the failing ownership tests**

In `apps/backend/src/modules/lodging/application/property.service.spec.ts` replace the whole `describe('PropertyService gallery ownership', …)` block (lines 34–80) with:

```ts
describe('PropertyService gallery ownership', () => {
  const ws = workspaceId('01890000-0000-7000-8000-000000000001');
  const other = '01890000-0000-7000-8000-000000000009';
  const file = '01890000-0000-7000-8000-0000000000aa.jpg';
  const clip = '01890000-0000-7000-8000-0000000000bb.mp4';
  const create = (item: { kind: string; url: string }, extra: object = {}) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const service = new PropertyService(
      { run } as unknown as LodgingStore,
      { assertHotel: () => Promise.resolve() } as unknown as LodgingAccess,
    );
    const input = {
      code: 'A20',
      name: 'Villa',
      sellMode: 'whole',
      standardAdults: 2,
      standardChildren: 0,
      gallery: [{ id: 'f1', name: 'Ảnh', items: [{ ...item, caption: '' }] }],
      ...extra,
    };
    return { run, done: service.create(ws, input as never, 'actor').catch((e: unknown) => e) };
  };

  it('refuses a Rapiz photo of another workspace, relative or on any host', async () => {
    for (const url of [
      `/media/products/${other}/${file}`,
      `https://old.trycloudflare.com/media/products/${other}/${file}`,
      `/media/workspaces/${ws}/bots/${other}/${file}`,
    ]) {
      const { run, done } = create({ kind: 'image', url });
      expect(await done, url).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'IMAGE_NOT_UPLOADED', field: 'gallery[0].items[0].url' },
      });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('accepts its own photos, external https photos, its own videos and video links', async () => {
    for (const item of [
      { kind: 'image', url: `/media/products/${ws}/${file}` },
      { kind: 'image', url: `https://old.trycloudflare.com/media/products/${ws}/${file}` },
      { kind: 'image', url: 'https://cdn.shop.vn/media/products/villa-1.jpg' },
      { kind: 'video', url: `/media/lodging/${ws}/${clip}` },
      { kind: 'link', url: 'https://youtu.be/abc' },
    ]) {
      const { run, done } = create(item);
      await done;
      expect(run, item.url).toHaveBeenCalled();
    }
  });

  it('refuses a video uploaded by another workspace', async () => {
    const { run, done } = create({ kind: 'video', url: `/media/lodging/${other}/${clip}` });
    expect(await done).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'VIDEO_NOT_UPLOADED', field: 'gallery[0].items[0].url' },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a cover that is not an image of the gallery', async () => {
    const { run, done } = create(
      { kind: 'image', url: `/media/products/${ws}/${file}` },
      { galleryCover: 'https://cdn.example.com/other.jpg' },
    );
    expect(await done).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Write the failing bot product tests**

In `apps/backend/src/modules/lodging/application/bot-catalog.spec.ts` replace the `gallery` of `property()` (lines 49–56) with:

```ts
    gallery: [
      {
        id: 'pool',
        name: 'Hồ bơi',
        items: [
          { kind: 'image', url: 'https://cdn.example.com/a17/1.jpg', caption: 'Bể bơi' },
          { kind: 'image', url: 'https://cdn.example.com/a17/2.jpg', caption: '' },
          {
            kind: 'video',
            url: `/media/lodging/${ws}/01890000-0000-7000-8000-0000000000e1.mp4`,
            caption: 'Tour',
          },
          { kind: 'link', url: 'https://youtu.be/a17', caption: 'Flycam' },
        ],
      },
      {
        id: 'rooms',
        name: 'Phòng ngủ',
        items: Array.from({ length: 5 }, (_, i) => ({
          kind: 'image' as const,
          url: `https://cdn.example.com/a17/${i + 3}.jpg`,
          caption: `Ảnh ${i + 3}`,
        })),
      },
    ],
    galleryCover: '',
```

Replace the two gallery assertions of the first test (lines 154–156) with:

```ts
    expect(acc.gallery).toHaveLength(7);
    // An empty caption falls back to the folder name (the image allowlist needs a label).
    expect(acc.gallery[1]?.caption).toBe('Hồ bơi');
```

and add these tests at the end of `describe('toBotProduct', …)`:

```ts
  it('carries the folders as albums, in order, with their videos and links', () => {
    const acc = ProductDto.parse(toBotProduct(property(), [wholeUnit()], a17Rates(), today))
      .accommodation!;
    expect(acc.albums?.map((a) => [a.name, a.items.map((i) => i.kind)])).toEqual([
      ['Hồ bơi', ['image', 'image', 'video', 'link']],
      ['Phòng ngủ', ['image', 'image', 'image', 'image', 'image']],
    ]);
    expect(acc.gallery.map((g) => g.url)).not.toContain('https://youtu.be/a17');
  });

  it('puts the chosen cover first in imageUrls, once', () => {
    const cover = 'https://cdn.example.com/a17/5.jpg';
    const dto = toBotProduct(property({ galleryCover: cover }), [wholeUnit()], a17Rates(), today);
    expect(dto?.imageUrls[0]).toBe(cover);
    expect(dto?.imageUrls.filter((u) => u === cover)).toHaveLength(1);
    expect(dto?.imageUrls).toHaveLength(5);
  });

  it('leaves albums out of a property without folders', () => {
    const acc = toBotProduct(property({ gallery: [] }), [wholeUnit()], a17Rates(), today)
      ?.accommodation;
    expect(acc?.albums).toBeUndefined();
    expect(acc?.gallery).toEqual([]);
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging`
Expected: FAIL — `LEGACY_FOLDER_NAME` is not exported, ownership `field` is still `gallery[0].url`, `acc.albums` is undefined.

- [ ] **Step 5: Change the record and the row mapping**

In `apps/backend/src/modules/lodging/application/ports/lodging-store.ts` change line 1 to `import type { BookingListQuery, GalleryFolder, Policies } from '@agent-sales/contracts';` and replace line 24 (`gallery: { url: string; caption: string }[];`) with:

```ts
  /** Media folders (T-192): photos, uploaded videos and video links, in the owner's order. */
  gallery: GalleryFolder[];
  /** '' = automatic cover (contracts `galleryCoverUrl`); else an image item's url. */
  galleryCover: string;
```

In `apps/backend/src/modules/lodging/infrastructure/persistence/lodging.rows.ts` change line 1 to `import { type GalleryFolder, type GalleryItem, Policies } from '@agent-sales/contracts';` and add after the `price` helper (line 24):

```ts
/** Id and name of the folder a flat (pre-0066) gallery reads as; migration 0066 uses this name. */
export const LEGACY_FOLDER_ID = 'legacy';
export const LEGACY_FOLDER_NAME = 'Ảnh chung';
const KINDS = new Set<string>(['image', 'video', 'link']);
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Rapiz photos and videos are host-relative `/media/…` paths; older rows name a former host. */
function toItem(raw: unknown): GalleryItem[] {
  const r = rec(raw);
  const kind = text(r['kind']);
  const url = text(r['url']);
  if (!KINDS.has(kind) || !url) return [];
  return [
    {
      kind,
      url: kind === 'link' ? url : toMediaPath(url),
      caption: text(r['caption']),
    } as GalleryItem,
  ];
}

/**
 * The stored gallery as folders. A flat `[{url, caption}]` list (a row written before 0066, or by
 * a later run of `lodging_copy_accommodations()`) reads as one "Ảnh chung" folder.
 */
export function toGallery(raw: unknown): GalleryFolder[] {
  if (!Array.isArray(raw)) return [];
  if (!raw.some((f) => 'items' in rec(f))) {
    const items = raw.flatMap((g) => toItem({ ...rec(g), kind: 'image' }));
    return items.length ? [{ id: LEGACY_FOLDER_ID, name: LEGACY_FOLDER_NAME, items }] : [];
  }
  return raw.flatMap((f) => {
    const r = rec(f);
    const id = text(r['id']);
    const name = text(r['name']);
    if (!id || !name) return [];
    return [{ id, name, items: (Array.isArray(r['items']) ? r['items'] : []).flatMap(toItem) }];
  });
}
```

In `toProperty` replace lines 45–46 (the comment and `gallery: r.gallery.map(…)`) with:

```ts
    gallery: toGallery(r.gallery),
    galleryCover: r.galleryCover ? toMediaPath(r.galleryCover) : '',
```

In `propertyValues` replace line 78 (`gallery: p.gallery.map(…)`) with:

```ts
    gallery: p.gallery.map((f) => ({
      id: f.id,
      name: f.name,
      items: f.items.map((i) => ({
        kind: i.kind,
        url: i.kind === 'link' ? i.url : toMediaPath(i.url),
        caption: i.caption,
      })),
    })),
    galleryCover: p.galleryCover ? toMediaPath(p.galleryCover) : '',
```

- [ ] **Step 6: Check folders and videos in the property service**

In `apps/backend/src/modules/lodging/application/property.service.ts` add `galleryCover: p.galleryCover,` after `gallery: p.gallery,` in `fieldsOf` (line 58) and replace `assertOwnGallery` (lines 63–76) with:

```ts
/**
 * Gallery photos that are Rapiz objects (a `/media/…` path, or such a URL on any host) must be
 * this workspace's product pictures, and every uploaded video must be this workspace's
 * (`/media/lodging/<ws>/…`); external https photos and video links stay allowed.
 */
function assertOwnGallery(
  ws: WorkspaceId,
  gallery: readonly { items: readonly { kind: string; url: string }[] }[] | undefined,
): void {
  gallery?.forEach((folder, f) =>
    folder.items.forEach((item, i) => {
      if (item.kind === 'link') return;
      const path = mediaPath(item.url);
      const field = `gallery[${f}].items[${i}].url`;
      if (item.kind === 'video' && !path?.startsWith(`/media/lodging/${ws}/`))
        throw new LodgingError('VALIDATION_FAILED', 'Gallery video is not one of this business', {
          reason: 'VIDEO_NOT_UPLOADED',
          field,
        });
      if (item.kind === 'image' && path && !path.startsWith(`/media/products/${ws}/`))
        throw new LodgingError('VALIDATION_FAILED', 'Gallery photo is not one of this business', {
          reason: 'IMAGE_NOT_UPLOADED',
          field,
        });
    }),
  );
}
```

(The two call sites, `assertOwnGallery(ws, fields.gallery)` in `create` and `assertOwnGallery(ws, input.patch.gallery)` in `update`, stay unchanged. The cover is checked by `PropertyInput` on the merged property.)

- [ ] **Step 7: Albums, flattened gallery and cover in the bot product**

In `apps/backend/src/modules/lodging/application/bot-product.ts`:
- Change line 1 to `import { type AccommodationDetails, galleryCoverUrl, type ProductDto } from '@agent-sales/contracts';`.
- Add `const MAX_ALBUMS = 20;` after line 9 (`const MAX_GALLERY = 30;`).
- Replace lines 112–115 (the `gallery` constant) with:

```ts
  const albums = p.gallery.slice(0, MAX_ALBUMS).map((f) => ({
    id: f.id,
    name: f.name,
    items: f.items.map((i) => ({ ...i, caption: i.caption.trim().slice(0, 300) })),
  }));
  // The flat photo list older readers know: every folder's photos in order, captioned by the
  // folder name when the owner left the caption empty (the image allowlist needs a label).
  const gallery = p.gallery
    .flatMap((f) =>
      f.items
        .filter((i) => i.kind === 'image')
        .map((i) => ({ url: i.url, caption: i.caption.trim().slice(0, 300) || f.name.slice(0, 300) })),
    )
    .slice(0, MAX_GALLERY)
    .map((g, i) => ({ url: g.url, caption: g.caption || `${p.code} photo ${i + 1}` }));
  const cover = galleryCoverUrl(p);
  const imageUrls = [...new Set([...(cover ? [cover] : []), ...gallery.map((g) => g.url)])].slice(
    0,
    MAX_IMAGE_URLS,
  );
```

- Replace line 135 (`gallery,`) with:

```ts
    gallery,
    ...(albums.length ? { albums } : {}),
```

- Replace line 170 (`imageUrls: gallery.slice(0, MAX_IMAGE_URLS).map((g) => g.url),`) with `imageUrls,`.
- Update the function's doc comment (line 54) to mention: `` `albums` carries the media folders (photos, videos, links) for the bot's album and video ids; `gallery` is their photos flattened. ``

- [ ] **Step 8: Update the remaining fixtures**

- `apps/backend/src/modules/lodging/application/calendar.service.spec.ts:40`: after `gallery: [],` add `galleryCover: '',`.
- `apps/backend/test/lodging-v2.integration.spec.ts:60`: replace the line with

```ts
    gallery: [
      {
        id: 'pool',
        name: 'Hồ bơi',
        items: [{ kind: 'image', url: 'https://media.rapiz.test/a17/0.jpg', caption: 'Hồ bơi' }],
      },
    ],
    galleryCover: '',
```

- `apps/backend/test/lodging-properties.integration.spec.ts`: add after the test `'re-validates the merged property on PATCH and keeps the whole unit in sync'`:

```ts
  it('saves media folders and a cover, and refuses a video of another business', async () => {
    const o = await signup();
    const p = await create(o.headers, villa());
    const own = `/media/lodging/${o.ws}/${newId()}.mp4`;
    const foreign = `/media/lodging/${newId()}/${newId()}.mp4`;
    const photo = 'https://cdn.example.com/a17/pool.jpg';
    const gallery = [
      {
        id: 'pool',
        name: 'Hồ bơi',
        items: [
          { kind: 'image', url: photo },
          { kind: 'video', url: own, caption: 'Tour' },
          { kind: 'link', url: 'https://youtu.be/a17', caption: 'Flycam' },
        ],
      },
    ];
    const saved = await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
        version: 1,
        patch: { gallery, galleryCover: photo },
      }),
    );
    expect(saved.galleryCover).toBe(photo);
    expect(saved.gallery[0]?.items.map((i) => i.kind)).toEqual(['image', 'video', 'link']);
    const bad = await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
      version: 2,
      patch: { gallery: [{ id: 'v', name: 'Video', items: [{ kind: 'video', url: foreign }] }] },
    });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(bad.json()).toMatchObject({ error: { details: { reason: 'VIDEO_NOT_UPLOADED' } } });
  });
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging`
Expected: PASS.
Run (Docker): `pnpm --filter @agent-sales/backend exec vitest run --config vitest.integration.config.ts test/lodging-properties.integration.spec.ts test/lodging-v2.integration.spec.ts test/lodging-migration.integration.spec.ts`
Expected: PASS (the 0041 copy test still sees the flat list the copy function writes; the new reader turns it into a folder).

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/lodging apps/backend/test/lodging-v2.integration.spec.ts apps/backend/test/lodging-properties.integration.spec.ts
git commit -m "feat(backend): lodging media folders in storage, ownership checks and bot albums (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lodging video upload endpoint

**Files:**
- Modify: `apps/backend/src/common/storage/public-object-storage.ts:19-46`
- Modify: `apps/backend/src/common/storage/public-object-storage.spec.ts` (append a `describe`)
- Create: `apps/backend/src/modules/lodging/domain/mp4.ts`, `apps/backend/src/modules/lodging/domain/mp4.spec.ts`
- Create: `apps/backend/src/modules/lodging/application/ports/lodging-media-storage.ts`
- Create: `apps/backend/src/modules/lodging/application/lodging-media.service.ts`, `apps/backend/src/modules/lodging/application/lodging-media.service.spec.ts`
- Create: `apps/backend/src/modules/lodging/interface/http/lodging-media.controller.ts`
- Modify: `apps/backend/src/modules/lodging/lodging.module.ts:1-55`
- Modify: `apps/backend/src/bootstrap.ts:54` (comment only)
- Create: `apps/backend/test/lodging-media-http.spec.ts`
- Modify: `apps/backend/test/lodging-properties.integration.spec.ts` (one new `it`)

**Interfaces:**
- Consumes (Task 1): `LODGING_VIDEO_MAX_BYTES`, `UploadLodgingVideoResponse`, the declared route `POST /lodging/media/videos`.
- Produces:
  - `S3PublicObjectStorage` option `requestTimeoutMs?: number` (default 15 000) and readonly property `requestTimeoutMs: number`.
  - `isMp4(bytes: Uint8Array): boolean` (`lodging/domain/mp4.ts`).
  - `LODGING_MEDIA_STORAGE: symbol` (`lodging/application/ports/lodging-media-storage.ts`).
  - `LodgingMediaService.uploadVideo(ws: WorkspaceId, read: () => Promise<Uint8Array>): Promise<UploadLodgingVideoResponse>` — key `lodging/<ws>/<uuidv7>.mp4`, content type `video/mp4`, answers the `/media/…` path.
  - HTTP errors: 413 `VALIDATION_FAILED` `details.reason = 'VIDEO_TOO_LARGE'`; 400 `details.reason = 'INVALID_VIDEO'`; 503 `MEDIA_STORAGE_UNAVAILABLE`; 404 for a non-hotel business.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/backend/src/modules/lodging/domain/mp4.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isMp4 } from './mp4.js';

const box = (brand: string) =>
  new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from(brand), 0, 0, 2, 0]);

describe('isMp4', () => {
  it('accepts an ISO-BMFF ftyp box of an MP4 brand', () => {
    for (const brand of ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'])
      expect(isMp4(box(brand)), brand).toBe(true);
  });
  it('refuses other brands, other boxes and short input', () => {
    expect(isMp4(box('qt  '))).toBe(false);
    expect(isMp4(new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('moovisom')]))).toBe(false);
    expect(isMp4(Buffer.from('hello world'))).toBe(false);
    expect(isMp4(new Uint8Array(0))).toBe(false);
  });
});
```

Create `apps/backend/src/modules/lodging/application/lodging-media.service.spec.ts`:

```ts
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { LodgingError } from '../domain/lodging.errors.js';
import type { LodgingAccess } from './lodging-access.js';
import { LodgingMediaService } from './lodging-media.service.js';

const ws = workspaceId('01890000-0000-7000-8000-000000000001');
const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0]);

function setup(hotel = true) {
  const put = vi.fn(async (key: string) => `https://rapiz.test/media/${key}`);
  const storage = { put, remove: vi.fn(), isPublicUrlUnder: () => false } as PublicObjectStorage;
  const access = {
    assertHotel: async () => {
      if (!hotel) throw new LodgingError('NOT_FOUND', 'Lodging workspace not found');
    },
  } as unknown as LodgingAccess;
  return { put, service: new LodgingMediaService(storage, access) };
}

describe('LodgingMediaService.uploadVideo', () => {
  it('stores an MP4 under lodging/<ws>/<uuid>.mp4 and answers its /media path and size', async () => {
    const { put, service } = setup();
    const res = await service.uploadVideo(ws, async () => mp4);
    const [key, bytes, mime] = put.mock.calls[0]!;
    expect(key).toMatch(new RegExp(`^lodging/${ws}/[0-9a-f-]{36}\\.mp4$`));
    expect(bytes).toBe(mp4);
    expect(mime).toBe('video/mp4');
    expect(res).toEqual({ url: `/media/${key}`, bytes: mp4.byteLength });
  });
  it('refuses bytes that are not an MP4 without storing them', async () => {
    const { put, service } = setup();
    await expect(service.uploadVideo(ws, async () => Buffer.from('GIF89a…'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'INVALID_VIDEO' },
    });
    expect(put).not.toHaveBeenCalled();
  });
  it('checks the business before reading the upload', async () => {
    const { put, service } = setup(false);
    const read = vi.fn(async () => mp4);
    await expect(service.uploadVideo(ws, read)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(read).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
```

Append to `apps/backend/src/common/storage/public-object-storage.spec.ts`:

```ts
describe('S3PublicObjectStorage request timeout', () => {
  it('defaults to 15 s and accepts a longer timeout for large uploads', () => {
    expect(configured().requestTimeoutMs).toBe(15_000);
    expect(new S3PublicObjectStorage({ requestTimeoutMs: 120_000 }).requestTimeoutMs).toBe(120_000);
  });
});
```

- [ ] **Step 2: Write the failing HTTP test**

Create `apps/backend/test/lodging-media-http.spec.ts`:

```ts
import { AuthResponse, BootstrapResponse, LODGING_VIDEO_MAX_BYTES } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { signUpVerified } from './support/signup.js';

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const url = '/api/v1/lodging/media/videos';
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32, 1)]);

function multipart(bytes: Buffer, type = 'video/mp4') {
  const boundary = '----rapiz-video-test';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tour.mp4"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function setup(industry = 'hotel') {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  app = booted.app;
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  const registered = await signUpVerified(app, {
    name: 'Video Owner',
    email: `lodging-video-${industry}@example.test`,
    password: 'correct horse battery',
    workspaceName: 'Video villas',
    industry,
  });
  const auth = AuthResponse.parse(registered.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const bootstrap = BootstrapResponse.parse(
    (await http.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { authorization } })).json(),
  );
  return {
    http,
    headers: { authorization, 'x-workspace-id': bootstrap.memberships[0]?.workspaceId ?? '' },
  };
}

describe('HTTP: POST /lodging/media/videos', () => {
  it('requires authentication', async () => {
    const { http } = await setup();
    const body = multipart(mp4);
    const res = await http.inject({ method: 'POST', url, ...body });
    expect(res.statusCode).toBe(401);
  });

  it('answers 404 for a business that is not a hotel', async () => {
    const { http, headers } = await setup('retail');
    const body = multipart(mp4);
    const res = await http.inject({ method: 'POST', url, payload: body.payload, headers: { ...headers, ...body.headers } });
    expect(res.statusCode, res.body).toBe(404);
  });

  it('rejects a file that is not an MP4 with 400 INVALID_VIDEO', async () => {
    const { http, headers } = await setup();
    const body = multipart(Buffer.from('GIF89a not a video'), 'video/mp4');
    const res = await http.inject({ method: 'POST', url, payload: body.payload, headers: { ...headers, ...body.headers } });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { details: { reason: 'INVALID_VIDEO' } } });
  });

  it('rejects a body that is not multipart with 400 INVALID_VIDEO', async () => {
    const { http, headers } = await setup();
    const res = await http.inject({ method: 'POST', url, headers, payload: { file: 'x' } });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { details: { reason: 'INVALID_VIDEO' } } });
  });

  it('rejects a video over 25 MB with 413 VIDEO_TOO_LARGE', async () => {
    const { http, headers } = await setup();
    const big = Buffer.concat([mp4, Buffer.alloc(LODGING_VIDEO_MAX_BYTES)]);
    const body = multipart(big);
    const res = await http.inject({ method: 'POST', url, payload: body.payload, headers: { ...headers, ...body.headers } });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(413);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { reason: 'VIDEO_TOO_LARGE' } },
    });
  });

  it('answers 503 MEDIA_STORAGE_UNAVAILABLE for a valid MP4 when no storage is configured', async () => {
    const { http, headers } = await setup();
    const body = multipart(mp4);
    const res = await http.inject({ method: 'POST', url, payload: body.payload, headers: { ...headers, ...body.headers } });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'UNAVAILABLE', details: { reason: 'MEDIA_STORAGE_UNAVAILABLE' } },
    });
  });
});
```

Add to `apps/backend/test/lodging-properties.integration.spec.ts` (inside the main `describe`, after the test added in Task 3):

```ts
  it('lets only catalog managers of the business upload a video', async () => {
    const o = await signup();
    const analyst = await member(o.ws, 'analyst');
    const stranger = await signup();
    const boundary = '----rapiz-video-test';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="v.mp4"\r\n` +
          'Content-Type: video/mp4\r\n\r\n',
      ),
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(16, 1),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = (h: Headers) =>
      app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: '/api/v1/lodging/media/videos',
          payload,
          headers: { ...h, 'content-type': `multipart/form-data; boundary=${boundary}` },
        });
    expect((await upload(analyst)).statusCode).toBe(403);
    expect((await upload(stranger.in(o.ws))).statusCode).toBe(404);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging/domain/mp4.spec.ts src/modules/lodging/application/lodging-media.service.spec.ts src/common/storage/public-object-storage.spec.ts test/lodging-media-http.spec.ts test/http.spec.ts`
Expected: FAIL — `./mp4.js` / `./lodging-media.service.js` not found; `http.spec.ts` reports `POST /lodging/media/videos` declared but not served.

- [ ] **Step 4: Configurable put timeout**

In `apps/backend/src/common/storage/public-object-storage.ts` add `requestTimeoutMs?: number | undefined;` to the constructor `options` type (after `secretKey`), add the field `readonly requestTimeoutMs: number;` above `readonly #client`, set `this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;` as the first statement of the constructor, and replace `requestHandler: { requestTimeout: 15_000 },` (line 43) with `requestHandler: { requestTimeout: this.requestTimeoutMs },`. Add a doc line above the field: `/** Per-request timeout of the S3 client; uploads of large files (lodging videos) need more. */`.

- [ ] **Step 5: MP4 sniff, port, service**

Create `apps/backend/src/modules/lodging/domain/mp4.ts`:

```ts
/** MP4 brands Messenger and browsers play; `qt  ` (QuickTime .mov) is not one of them. */
const BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash']);

/** True when the bytes start with an ISO-BMFF `ftyp` box whose major brand is an MP4 brand. */
export function isMp4(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const ascii = (from: number) => String.fromCharCode(...bytes.subarray(from, from + 4));
  return ascii(4) === 'ftyp' && BRANDS.has(ascii(8));
}
```

Create `apps/backend/src/modules/lodging/application/ports/lodging-media-storage.ts`:

```ts
/** The public object store lodging videos go to (`PublicObjectStorage`, 120 s put timeout). */
export const LODGING_MEDIA_STORAGE = Symbol('LODGING_MEDIA_STORAGE');
```

Create `apps/backend/src/modules/lodging/application/lodging-media.service.ts`:

```ts
import type { UploadLodgingVideoResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { toMediaPath } from '../../../common/storage/media-url.js';
import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { isMp4 } from '../domain/mp4.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_MEDIA_STORAGE } from './ports/lodging-media-storage.js';

/**
 * Videos of lodging galleries (T-192): MP4 files on Rapiz storage under `lodging/<ws>/`, answered
 * as their host-relative `/media/…` path. Deleting a gallery item never deletes the object.
 */
@Injectable()
export class LodgingMediaService {
  constructor(
    @Inject(LODGING_MEDIA_STORAGE) private readonly storage: PublicObjectStorage,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  /** `read` returns the uploaded bytes; it runs only after the business check. */
  async uploadVideo(
    ws: WorkspaceId,
    read: () => Promise<Uint8Array>,
  ): Promise<UploadLodgingVideoResponse> {
    await this.access.assertHotel(ws);
    const bytes = await read();
    if (!isMp4(bytes))
      throw new LodgingError('VALIDATION_FAILED', 'Upload an MP4 video', { reason: 'INVALID_VIDEO' });
    const key = `lodging/${ws}/${newId()}.mp4`;
    const url = toMediaPath(await this.storage.put(key, bytes, 'video/mp4'));
    return { url, bytes: bytes.byteLength };
  }
}
```

- [ ] **Step 6: Controller and module wiring**

Create `apps/backend/src/modules/lodging/interface/http/lodging-media.controller.ts`:

```ts
import { LODGING_VIDEO_MAX_BYTES, type UploadLodgingVideoResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';

import { ApiError } from '../../../../common/http/api-error.js';
import {
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { LodgingMediaService } from '../../application/lodging-media.service.js';

const invalid = () =>
  new ApiError('VALIDATION_FAILED', 'Send one MP4 file in the multipart field "file"', {
    reason: 'INVALID_VIDEO',
  });

/** The bytes of the single `file` part; at most 25 MiB (413 VIDEO_TOO_LARGE above it). */
async function readVideoPart(req: FastifyRequest): Promise<Uint8Array> {
  if (!req.isMultipart()) throw invalid();
  try {
    const file = await req.file({ limits: { fileSize: LODGING_VIDEO_MAX_BYTES, files: 1 } });
    if (!file) throw invalid();
    const bytes = await file.toBuffer();
    if (file.mimetype !== 'video/mp4') throw invalid();
    return bytes;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
      throw new ApiError(
        'VALIDATION_FAILED',
        'The video is larger than 25 MB',
        { reason: 'VIDEO_TOO_LARGE' },
        413,
      );
    throw invalid();
  }
}

/** `POST /lodging/media/videos` (lodgingV2Routes): gallery video upload, multipart. */
@WorkspaceScoped()
@Controller('lodging/media')
export class LodgingMediaController {
  constructor(@Inject(LodgingMediaService) private readonly media: LodgingMediaService) {}

  @Post('videos')
  @HttpCode(201)
  @RequireCapability('catalog.manage')
  uploadVideo(
    @CurrentWorkspace() ws: WorkspaceId,
    @Req() req: FastifyRequest,
  ): Promise<UploadLodgingVideoResponse> {
    return this.media.uploadVideo(ws, () => readVideoPart(req));
  }
}
```

In `apps/backend/src/modules/lodging/lodging.module.ts` add the imports

```ts
import { getEnv } from '../../common/config.js';
import { S3PublicObjectStorage } from '../../common/storage/public-object-storage.js';
import { LodgingMediaService } from './application/lodging-media.service.js';
import { LODGING_MEDIA_STORAGE } from './application/ports/lodging-media-storage.js';
import { LodgingMediaController } from './interface/http/lodging-media.controller.js';
```

add `LodgingMediaController` to `controllers`, and add to `providers` (after `NightNotesService,`):

```ts
    {
      provide: LODGING_MEDIA_STORAGE,
      // Its own client: a 25 MB video needs a longer put than a product picture (15 s).
      useFactory: () => {
        const env = getEnv();
        return new S3PublicObjectStorage({
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET,
          publicUrl: env.S3_PUBLIC_URL,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
          requestTimeoutMs: 120_000,
        });
      },
    },
    LodgingMediaService,
```

In `apps/backend/src/bootstrap.ts` change the comment on line 54 to: `// Parsed only where a handler calls \`req.file()\` (widget image upload, lodging video upload); each call sets its own fileSize.`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/lodging src/common/storage test/lodging-media-http.spec.ts test/http.spec.ts test/architecture.spec.ts`
Expected: PASS.
Run (Docker): `pnpm --filter @agent-sales/backend exec vitest run --config vitest.integration.config.ts test/lodging-properties.integration.spec.ts`
Expected: PASS (analyst 403, other business 404).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/common/storage apps/backend/src/modules/lodging apps/backend/src/bootstrap.ts apps/backend/test/lodging-media-http.spec.ts apps/backend/test/lodging-properties.integration.spec.ts
git commit -m "feat(backend): lodging MP4 video upload with ftyp check and 25 MB limit (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: AI model view — album and video ids, folder summary, album paging

**Files:**
- Modify: `apps/backend/src/modules/ai/domain/image-allowlist.ts:1-26, 62-65, 190-194`
- Modify: `apps/backend/src/modules/ai/domain/catalog-context.ts:27-35`
- Modify: `apps/backend/src/modules/ai/domain/product-view.ts:4, 47-58, 112-128`
- Test: `apps/backend/src/modules/ai/__tests__/image-allowlist.spec.ts` (append), `apps/backend/src/modules/ai/__tests__/lodging-context.spec.ts` (append)

**Interfaces:**
- Consumes (Task 1): `BOT_ALBUM_PAGE_SIZE`; (Task 3) bot products with `accommodation.albums`.
- Produces (`ai/domain/image-allowlist.ts`):
  - `interface AllowedAlbum { id: string; label: string; images: { url: string; label: string }[] }` — id `a:<productId>:<folderIndex>`, label `"<product> – <folder> (N ảnh)"`, image label `"<product> – <caption or folder>"`.
  - `interface AllowedVideo { id: string; label: string; kind: 'video' | 'link'; url: string; title: string }` — id `v:<productId>:<folderIndex>:<itemIndex>`, label `"<product> – <folder> – video: <caption or 'video N'>"`.
  - `MAX_PRODUCT_ALBUMS = 20`, `MAX_PRODUCT_VIDEOS = 10`.
  - `productAlbums(products: readonly MediaProduct[]): AllowedAlbum[]`, `productVideos(products: readonly MediaProduct[]): AllowedVideo[]` where `MediaProduct = { id: string; name: string; accommodation?: { albums?: readonly { name: string; items: readonly { kind: string; url: string; caption: string }[] }[] | undefined } | null | undefined }`.
  - `nextAlbumPage(sent: readonly boolean[], size?: number): { indexes: number[]; remaining: number; restarted: boolean }`.
  - `productIdOfImage` also reads `a:<pid>:<f>(:<k>)` and `v:<pid>:<f>:<i>`.
- Produces (`product-view.ts`): `ProductDetails.albums?: {id,label}[]`, `ProductDetails.videos?: {id,label}[]`; `catalogProductContext(p).accommodation.albums` = `[{ name, photos, videos, links }]` (only when the product has albums).

- [ ] **Step 1: Write the failing allowlist tests**

Append to `apps/backend/src/modules/ai/__tests__/image-allowlist.spec.ts` (extend the import from `../domain/image-allowlist.js` with `MAX_PRODUCT_ALBUMS, MAX_PRODUCT_VIDEOS, nextAlbumPage, productAlbums, productVideos`):

```ts
const WS = '0192f0a0-0000-7000-8000-000000000001';
const CLIP = `/media/lodging/${WS}/0192f0a0-0000-7000-8000-0000000000cc.mp4`;
const villa = {
  id: 'villa-1',
  name: 'A17 – Villa',
  accommodation: {
    albums: [
      {
        name: 'Ngoài trời',
        items: [
          { kind: 'image', url: 'https://cdn.example.com/o1.jpg', caption: 'Hồ bơi' },
          { kind: 'image', url: 'http://insecure.example/x.jpg', caption: '' },
          { kind: 'link', url: 'https://youtu.be/flycam', caption: '' },
        ],
      },
      { name: 'Video', items: [{ kind: 'video', url: CLIP, caption: 'Giới thiệu' }] },
      {
        name: 'Phòng ngủ',
        items: Array.from({ length: 12 }, (_, i) => ({
          kind: 'image',
          url: `https://cdn.example.com/b${i}.jpg`,
          caption: '',
        })),
      },
    ],
  },
};

describe('lodging albums and videos', () => {
  it('lists one album per folder that has sendable photos, with its photo count', () => {
    const albums = productAlbums([villa]);
    expect(albums.map((a) => [a.id, a.label, a.images.length])).toEqual([
      ['a:villa-1:0', 'A17 – Villa – Ngoài trời (1 ảnh)', 1],
      ['a:villa-1:2', 'A17 – Villa – Phòng ngủ (12 ảnh)', 12],
    ]);
    expect(albums[0]?.images[0]).toEqual({
      url: 'https://cdn.example.com/o1.jpg',
      label: 'A17 – Villa – Hồ bơi',
    });
    expect(albums[1]?.images[0]?.label).toBe('A17 – Villa – Phòng ngủ');
  });

  it('lists uploaded videos and links with their folder, numbered per folder when untitled', () => {
    expect(productVideos([villa]).map((v) => [v.id, v.kind, v.label])).toEqual([
      ['v:villa-1:0:2', 'link', 'A17 – Villa – Ngoài trời – video: video 1'],
      ['v:villa-1:1:0', 'video', 'A17 – Villa – Video – video: Giới thiệu'],
    ]);
  });

  it('caps albums at 20 and videos at 10 per product, and ignores products without albums', () => {
    const many = {
      id: 'm',
      name: 'M',
      accommodation: {
        albums: Array.from({ length: 25 }, (_, f) => ({
          name: `F${f}`,
          items: [
            { kind: 'image', url: `https://cdn.example.com/${f}.jpg`, caption: '' },
            { kind: 'link', url: `https://youtu.be/${f}`, caption: '' },
          ],
        })),
      },
    };
    expect(productAlbums([many])).toHaveLength(MAX_PRODUCT_ALBUMS);
    expect(productVideos([many])).toHaveLength(MAX_PRODUCT_VIDEOS);
    expect(productAlbums([product])).toEqual([]);
  });

  it('pages a folder 8 at a time, skipping what was sent, then starts again', () => {
    const sent = (n: number, total = 12) => Array.from({ length: total }, (_, i) => i < n);
    expect(nextAlbumPage(sent(0))).toEqual({
      indexes: [0, 1, 2, 3, 4, 5, 6, 7],
      remaining: 4,
      restarted: false,
    });
    expect(nextAlbumPage(sent(8))).toEqual({ indexes: [8, 9, 10, 11], remaining: 0, restarted: false });
    expect(nextAlbumPage(sent(12))).toEqual({
      indexes: [0, 1, 2, 3, 4, 5, 6, 7],
      remaining: 4,
      restarted: true,
    });
    expect(nextAlbumPage([false, true, false])).toEqual({ indexes: [0, 2], remaining: 0, restarted: false });
  });

  it('finds the product of album and video ids', () => {
    expect(productIdOfImage('a:villa-1:2:5')).toBe('villa-1');
    expect(productIdOfImage('v:villa-1:0:2')).toBe('villa-1');
    expect(productIdOfImage('p:villa-1:3')).toBe('villa-1');
    expect(productIdOfImage('m:size')).toBeNull();
  });
});
```

Append to `apps/backend/src/modules/ai/__tests__/lodging-context.spec.ts` (inside `describe('lodging catalog grounding', …)`):

```ts
  it('shows the model a folder summary and album / video ids, never media URLs', () => {
    const withAlbums: ProductDto = {
      ...product,
      accommodation: {
        ...details,
        albums: [
          {
            id: 'f1',
            name: 'Phòng ngủ',
            items: [
              { kind: 'image', url: 'https://images.example.test/b1.jpg', caption: '' },
              { kind: 'image', url: 'https://images.example.test/b2.jpg', caption: '' },
              { kind: 'link', url: 'https://youtu.be/tour', caption: 'Tour' },
            ],
          },
        ],
      },
    };
    const ctx = catalogProductContext(withAlbums);
    expect(ctx).toMatchObject({
      accommodation: { albums: [{ name: 'Phòng ngủ', photos: 2, videos: 0, links: 1 }] },
    });
    const full = productDetails(withAlbums);
    expect(full.albums).toEqual([
      { id: `a:${product.id}:0`, label: 'Test property – Phòng ngủ (2 ảnh)' },
    ]);
    expect(full.videos).toEqual([
      { id: `v:${product.id}:0:2`, label: 'Test property – Phòng ngủ – video: Tour' },
    ]);
    expect(JSON.stringify(full)).not.toContain('https://');
    expect(JSON.stringify(ctx)).not.toContain('youtu.be');
    expect(productDetails(product)).not.toHaveProperty('albums');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai/__tests__/image-allowlist.spec.ts src/modules/ai/__tests__/lodging-context.spec.ts`
Expected: FAIL — `productAlbums` / `nextAlbumPage` not exported; `full.albums` undefined.

- [ ] **Step 3: Implement albums, videos and paging in the allowlist domain**

In `apps/backend/src/modules/ai/domain/image-allowlist.ts` change line 1 to `import { BOT_ALBUM_PAGE_SIZE, isMediaPath } from '@agent-sales/contracts';` and add after `MAX_GALLERY_IMAGES` (line 65):

```ts
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

interface MediaProduct {
  id: string;
  name: string;
  accommodation?:
    | {
        albums?:
          | readonly { name: string; items: readonly { kind: string; url: string; caption: string }[] }[]
          | undefined;
      }
    | null
    | undefined;
}

const albumsOf = (product: MediaProduct) =>
  (product.accommodation?.albums ?? []).slice(0, MAX_PRODUCT_ALBUMS);

/**
 * The folders of lodging products, ids `a:<productId>:<folderIndex>`, each with its sendable
 * photos in the owner's order. Folders without a sendable photo are not albums.
 */
export function productAlbums(products: readonly MediaProduct[]): AllowedAlbum[] {
  return products.flatMap((product) =>
    albumsOf(product).flatMap((folder, f) => {
      const images = folder.items
        .filter((item) => item.kind === 'image' && isSendable(item.url))
        .map((item) => ({
          url: item.url,
          label: `${product.name} – ${item.caption.trim() || folder.name}`,
        }));
      return images.length
        ? [
            {
              id: `a:${product.id}:${f}`,
              label: `${product.name} – ${folder.name} (${images.length} ảnh)`,
              images,
            },
          ]
        : [];
    }),
  );
}

/** Uploaded videos and video links of lodging products, ids `v:<productId>:<folder>:<item>`. */
export function productVideos(products: readonly MediaProduct[]): AllowedVideo[] {
  return products.flatMap((product) =>
    albumsOf(product)
      .flatMap((folder, f) => {
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
                  label: `${product.name} – ${folder.name} – video: ${title}`,
                  kind: item.kind,
                  url: item.url,
                  title,
                },
              ]
            : [];
        });
      })
      .slice(0, MAX_PRODUCT_VIDEOS),
  );
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
```

Replace `productIdOfImage` (lines 190–194) with:

```ts
/**
 * The product id inside a product image id (`p:<productId>:<index>`), an album photo id
 * (`a:<productId>:<folder>:<index>`), an album id (`a:<productId>:<folder>`) or a video id
 * (`v:<productId>:<folder>:<item>`); null for library images.
 */
export function productIdOfImage(imageId: string): string | null {
  const m = /^p:(.+):\d+$/.exec(imageId) ?? /^[av]:([^:]+):\d+(?::\d+)?$/.exec(imageId);
  return m?.[1] ?? null;
}
```

- [ ] **Step 4: Folder summary and id lists in the model view**

In `apps/backend/src/modules/ai/domain/catalog-context.ts` replace lines 27–35 (the accommodation branch) with:

```ts
  if (product.accommodation) {
    const { gallery: _gallery, albums, ...details } = product.accommodation;
    // What each folder holds, never a URL: the model sends one through its album / video ids.
    const summary = (albums ?? []).map((a) => ({
      name: a.name,
      photos: a.items.filter((i) => i.kind === 'image').length,
      videos: a.items.filter((i) => i.kind === 'video').length,
      links: a.items.filter((i) => i.kind === 'link').length,
    }));
    return {
      ...base,
      catalogKind: 'accommodation',
      accommodation: summary.length ? { ...details, albums: summary } : details,
      availability: 'unverified',
    };
  }
```

In `apps/backend/src/modules/ai/domain/product-view.ts` change line 4 to `import { productAlbums, productImages, productVideos } from './image-allowlist.js';`, add to `ProductDetails` (after `images: { id: string; label: string }[];`):

```ts
  /** Lodging folders the model may send with `send_message` `albumId` (next 8 photos). */
  albums?: { id: string; label: string }[];
  /** Lodging videos and video links the model may send with `send_message` `videoId`. */
  videos?: { id: string; label: string }[];
```

add after `imageList` (line 58):

```ts
const idLabel = ({ id, label }: { id: string; label: string }) => ({ id, label });
```

and in `productDetails` replace the `return { … } as ProductDetails;` (lines 121–127) with:

```ts
  const albums = productAlbums([p]).map(idLabel);
  const videos = productVideos([p]).map(idLabel);
  return {
    ...compact,
    ...rest,
    description: cleanDescription(p.description, DESCRIPTION_MAX),
    instructions: cleanDescription(instructions, DESCRIPTION_MAX),
    images: imageList(p),
    ...(albums.length ? { albums } : {}),
    ...(videos.length ? { videos } : {}),
  } as ProductDetails;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai`
Expected: PASS (snapshots unchanged: products without albums get no new keys).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/ai/domain apps/backend/src/modules/ai/__tests__/image-allowlist.spec.ts apps/backend/src/modules/ai/__tests__/lodging-context.spec.ts
git commit -m "feat(ai): album and video ids and folder summary in the lodging model view (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: AI tools — `send_message` `albumId` / `videoId`, paging over already-sent media, trace detail

**Files:**
- Modify: `packages/contracts/src/ai/ai.schema.ts:28-41, 83-97`
- Modify: `apps/backend/src/modules/ai/api/reply-options.ts:10-15, 27-45`
- Modify: `apps/backend/src/modules/ai/application/output-tools.ts` (whole file, see steps)
- Modify: `apps/backend/src/modules/ai/application/reply-pipeline.ts:16, 61-97`
- Modify: `apps/backend/src/modules/ai/application/playground.service.ts:271-274, 395-410`
- Modify: `apps/backend/src/modules/ai/application/trace-detail.ts:165-173`
- Create: `apps/backend/src/modules/ai/__tests__/album-sends.spec.ts`
- Modify: `apps/backend/src/modules/ai/__tests__/trace-detail.spec.ts` (one new `it`)

**Interfaces:**
- Consumes (Task 5): `AllowedAlbum`, `AllowedVideo`, `productAlbums`, `productVideos`, `nextAlbumPage`; (common) `mediaPath`, `absoluteMediaUrl`.
- Produces:
  - `PlaygroundRequest.sentMediaUrls?: string[]` (≤ 200, each ≤ 2000); `PlaygroundResponse.messages[].videos?: {id,url,label}[]`.
  - `OutgoingMessage.videos?: { id: string; url: string; label: string }[]` (at most one); `ReplyOptions.sentMediaUrls?: readonly string[]`.
  - `ImageAllowlist.addProducts(products: readonly ProductDto[])`, `.addMedia(products: readonly ProductDto[])`, `.album(id: string): AllowedAlbum | undefined`, `.video(id: string): AllowedVideo | undefined`.
  - `outputTools({ …, sentMediaUrls?: readonly string[] })`; `turnTools({ …, sentMediaUrls?: readonly string[] })`.
  - `SentMessage.videos?: {id,url,label}[]`.
  - `send_message` input `{ text?, imageIds? (≤3), albumId?, videoId? }`; `albumId` + `imageIds` refused; result `{ status: 'sent', delivered, album?: { sent, remaining, restarted? }, video?: 'video' | 'link', incomplete?: true, droppedImageIds? }` (`incomplete` when the sink answered `complete: false`, e.g. Meta rejected the video; the trace detail keeps it). Album photo ids `a:<pid>:<f>:<k>`.

- [ ] **Step 1: Write the failing tool tests**

Create `apps/backend/src/modules/ai/__tests__/album-sends.spec.ts`:

```ts
import type { ProductDto } from '@agent-sales/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { MessageSink, OutgoingMessage } from '../api/reply-options.js';
import {
  ImageAllowlist,
  newOutputState,
  outputTools,
  SEND_MESSAGE_TOOL,
} from '../application/output-tools.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const BASE = 'https://rapiz.test/media';
const CLIP = `/media/lodging/${WS}/0192f0a0-0000-7000-8000-0000000000cc.mp4`;
/** Twelve stored bedroom photos (Rapiz paths), sent on the current public host. */
const bedrooms = Array.from(
  { length: 12 },
  (_, i) => `/media/products/${WS}/0192f0a0-0000-7000-8000-0000000001${String(i).padStart(2, '0')}.jpg`,
);
const abs = (path: string) => `https://rapiz.test${path}`;
const villa = {
  id: 'villa-1',
  name: 'A17 – Villa',
  imageUrls: [],
  accommodation: {
    gallery: [],
    albums: [
      {
        id: 'rooms',
        name: 'Phòng ngủ',
        items: bedrooms.map((url) => ({ kind: 'image', url, caption: '' })),
      },
      {
        id: 'clips',
        name: 'Video',
        items: [
          { kind: 'video', url: CLIP, caption: 'Giới thiệu' },
          { kind: 'link', url: 'https://youtu.be/flycam', caption: 'Flycam' },
        ],
      },
    ],
  },
} as unknown as ProductDto;

function setup(sentMediaUrls: string[] = []) {
  const sent: OutgoingMessage[] = [];
  const sink: MessageSink = {
    send: vi.fn(async (m: OutgoingMessage) => {
      sent.push(m);
      return { delivered: 1 };
    }),
  };
  const allowlist = new ImageAllowlist([], BASE);
  allowlist.addProducts([villa]);
  const state = newOutputState();
  const tool = outputTools({ sink, allowlist, state, sendMessage: true, sentMediaUrls }).runnable.find(
    (t) => t.name === SEND_MESSAGE_TOOL,
  );
  if (!tool) throw new Error('send_message missing');
  const send = async (input: object) =>
    JSON.parse((await tool.run(input)).content) as Record<string, unknown>;
  return { sent, state, send, tool };
}

describe('send_message albums', () => {
  it('sends the first 8 photos of a folder and says how many remain', async () => {
    const { sent, state, send } = setup();
    const res = await send({ text: 'Dạ ảnh phòng ngủ ạ', albumId: 'a:villa-1:0' });
    expect(res).toEqual({ status: 'sent', delivered: 1, album: { sent: 8, remaining: 4 } });
    expect(sent[0]?.text).toBe('Dạ ảnh phòng ngủ ạ');
    expect(sent[0]?.images.map((i) => i.url)).toEqual(bedrooms.slice(0, 8).map(abs));
    expect(sent[0]?.images[0]?.id).toBe('a:villa-1:0:0');
    expect(state.sent[0]?.images).toHaveLength(8);
  });

  it('sends the next page in the same turn, then starts again from the first photo', async () => {
    const { sent, send } = setup();
    await send({ albumId: 'a:villa-1:0' });
    expect(await send({ albumId: 'a:villa-1:0' })).toMatchObject({ album: { sent: 4, remaining: 0 } });
    expect(sent[1]?.images.map((i) => i.url)).toEqual(bedrooms.slice(8).map(abs));
    expect(await send({ albumId: 'a:villa-1:0' })).toMatchObject({
      album: { sent: 8, remaining: 4, restarted: true },
    });
  });

  it('skips the photos the conversation already received, on whatever host they went out', async () => {
    const { sent, send } = setup(bedrooms.slice(0, 8).map((p) => `https://old.trycloudflare.com${p}`));
    expect(await send({ albumId: 'a:villa-1:0' })).toMatchObject({ album: { sent: 4, remaining: 0 } });
    expect(sent[0]?.images.map((i) => i.url)).toEqual(bedrooms.slice(8).map(abs));
  });

  it('refuses albumId together with imageIds and drops an unknown album', async () => {
    const { tool, send } = setup();
    expect(tool.schema.safeParse({ albumId: 'a:villa-1:0', imageIds: ['p:villa-1:0'] }).success).toBe(
      false,
    );
    expect(await send({ text: 'Dạ', albumId: 'a:other:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      droppedImageIds: ['a:other:0'],
    });
  });
});

describe('send_message videos', () => {
  it('sends an uploaded video as a video on the current public base', async () => {
    const { sent, send } = setup();
    expect(await send({ text: 'Dạ video ạ', videoId: 'v:villa-1:1:0' })).toEqual({
      status: 'sent',
      delivered: 1,
      video: 'video',
    });
    expect(sent[0]?.videos).toEqual([
      { id: 'v:villa-1:1:0', url: abs(CLIP), label: 'A17 – Villa – Video – video: Giới thiệu' },
    ]);
  });

  it('appends a video link to the text', async () => {
    const { sent, send } = setup();
    expect(await send({ videoId: 'v:villa-1:1:1' })).toMatchObject({ video: 'link' });
    expect(sent[0]?.text).toBe('Flycam: https://youtu.be/flycam');
    expect(sent[0]?.videos).toBeUndefined();
  });

  it('reports a send that did not fully go out, e.g. a video Meta rejected', async () => {
    const allowlist = new ImageAllowlist([], BASE);
    allowlist.addProducts([villa]);
    const sink: MessageSink = { send: async () => ({ delivered: 1, complete: false }) };
    const tool = outputTools({ sink, allowlist, state: newOutputState(), sendMessage: true })
      .runnable.find((t) => t.name === SEND_MESSAGE_TOOL);
    const res = JSON.parse((await tool!.run({ text: 'Dạ video ạ', videoId: 'v:villa-1:1:0' })).content);
    expect(res).toEqual({ status: 'sent', delivered: 1, video: 'video', incomplete: true });
  });
});
```

Add to `apps/backend/src/modules/ai/__tests__/trace-detail.spec.ts` after the existing `send_message` test:

```ts
  it('send_message: album page and video flags, never ids or URLs', () => {
    const out = toolDetail(
      'send_message',
      { albumId: 'a:p:0', videoId: 'v:p:1:0' },
      j({
        status: 'sent',
        delivered: 2,
        album: { sent: 8, remaining: 4 },
        video: 'video',
        incomplete: true,
      }),
    );
    expect(out.detail).toEqual({
      chars: 0,
      imageCount: 0,
      droppedImages: 0,
      delivered: true,
      album: true,
      albumSent: 8,
      albumRemaining: 4,
      video: true,
      incomplete: true,
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai/__tests__/album-sends.spec.ts src/modules/ai/__tests__/trace-detail.spec.ts`
Expected: FAIL — `allowlist.addProducts is not a function`; trace detail lacks `album`.

- [ ] **Step 3: Contracts and reply options**

In `packages/contracts/src/ai/ai.schema.ts` add to `PlaygroundRequest` (after `phoneKnown`):

```ts
  /**
   * Picture URLs the bot already sent in this test chat (the playground stores no conversation):
   * `send_message` with an `albumId` sends the folder's photos not among them first (T-192).
   */
  sentMediaUrls: z.array(z.string().max(2000)).max(200).optional(),
```

and in `PlaygroundResponse.messages` items add after `images`:

```ts
        /** An uploaded video this message sent (T-192). */
        videos: z.array(z.object({ id: z.string(), url: z.string(), label: z.string() })).optional(),
```

Then run `pnpm --filter @agent-sales/contracts build`.

In `apps/backend/src/modules/ai/api/reply-options.ts` add to `OutgoingMessage` after `images`:

```ts
  /** At most one uploaded video, delivered as its own message after the pictures (T-192). */
  videos?: { id: string; url: string; label: string }[];
```

and to `ReplyOptions` after `turnTimes`:

```ts
  /**
   * Attachment URLs the bot already sent in this conversation (last 30 days): `send_message` with
   * an `albumId` sends the folder's photos not among them first (T-192). Absent: none.
   */
  sentMediaUrls?: readonly string[];
```

- [ ] **Step 4: Albums and videos in `output-tools.ts`**

In `apps/backend/src/modules/ai/application/output-tools.ts`:

Replace the imports (lines 1–8) with:

```ts
import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import type { ProductDto } from '@agent-sales/contracts';
import { z } from 'zod';

import { absoluteMediaUrl, mediaPath } from '../../../common/storage/media-url.js';
import type { MessageSink, OutgoingMessage, QuickReply } from '../api/reply-options.js';
import {
  type AllowedAlbum,
  type AllowedImage,
  type AllowedVideo,
  nextAlbumPage,
  productAlbums,
  productImages,
  productVideos,
} from '../domain/image-allowlist.js';
import { normalizeReplyText } from '../domain/reply-text.js';
import { safeJson } from './action-tools.js';
```

Replace `SendMessageInput` (lines 15–22) with:

```ts
const SendMessageInput = z
  .object({
    text: z.string().max(MAX_SEND_TEXT_CHARS).optional(),
    imageIds: z.array(z.string().max(200)).max(MAX_SEND_IMAGES).optional(),
    albumId: z.string().max(200).optional(),
    videoId: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.text?.trim()) ||
      Boolean(v.imageIds?.length) ||
      Boolean(v.albumId?.trim()) ||
      Boolean(v.videoId?.trim()),
    { message: 'give text, imageIds, albumId or videoId' },
  )
  .refine((v) => !(v.albumId?.trim() && v.imageIds?.length), {
    message: 'give albumId or imageIds, not both',
    path: ['albumId'],
  });
```

In `SentMessage` add after `images`:

```ts
  /** An uploaded video sent as its own message (T-192). */
  videos?: { id: string; url: string; label: string }[];
```

In `class ImageAllowlist` add the two maps next to `#byId`:

```ts
  readonly #albums = new Map<string, AllowedAlbum>();
  readonly #videos = new Map<string, AllowedVideo>();
```

and these methods after `add`:

```ts
  /** Pictures, folders and videos of products whose details the model received. */
  addProducts(products: readonly ProductDto[]): void {
    this.add(productImages(products));
    this.addMedia(products);
  }

  /** Folders and videos only (focus products: their pictures are already ranked into the list). */
  addMedia(products: readonly ProductDto[]): void {
    for (const album of productAlbums(products)) {
      if (this.#albums.has(album.id)) continue;
      const images = album.images
        .map((image) => ({ ...image, url: absoluteMediaUrl(image.url, this.mediaBase) }))
        .filter((image) => image.url.startsWith('https://'));
      if (images.length) this.#albums.set(album.id, { ...album, images });
    }
    for (const video of productVideos(products)) {
      if (this.#videos.has(video.id)) continue;
      const url = video.kind === 'video' ? absoluteMediaUrl(video.url, this.mediaBase) : video.url;
      if (url.startsWith('https://')) this.#videos.set(video.id, { ...video, url });
    }
  }

  album(id: string): AllowedAlbum | undefined {
    return this.#albums.get(id.trim());
  }

  video(id: string): AllowedVideo | undefined {
    return this.#videos.get(id.trim());
  }
```

Replace the `SEND_MESSAGE_DEFINITION.description` with:

```ts
    'Sends one chat message to the customer right away, while you keep working: optional text (max 2000 characters) and either up to 3 picture ids (from product "images" or the "Images you may send" list) or one albumId (from product "albums": sends the next 8 photos of that folder the customer has not received yet; the result says how many remain), plus at most one videoId (from product "videos"). Call it several times for more. Do not repeat its text in your answer.',
```

Change the `outputTools` options type to add `sentMediaUrls?: readonly string[];` and replace the `sendMessage` runnable (lines 118–139) with:

```ts
  // Album paging (spec D3): a photo the conversation already received (any host) or that went
  // out earlier in this turn counts as sent.
  const sentKey = (url: string): string => mediaPath(url) ?? url;
  const earlier = new Set((opts.sentMediaUrls ?? []).map(sentKey));
  const wasSent = (url: string): boolean =>
    earlier.has(sentKey(url)) ||
    state.sent.some((m) => m.images.some((image) => sentKey(image.url) === sentKey(url)));

  const sendMessage: RunnableTool = {
    name: SEND_MESSAGE_TOOL,
    readOnly: false,
    schema: SendMessageInput,
    run: async (input) => {
      const args = input as z.infer<typeof SendMessageInput>;
      const albumId = args.albumId?.trim() ?? '';
      const videoId = args.videoId?.trim() ?? '';
      const { images: picked, dropped } = allowlist.resolve(args.imageIds ?? []);
      const album = albumId ? allowlist.album(albumId) : undefined;
      const video = videoId ? allowlist.video(videoId) : undefined;
      if (albumId && !album) dropped.push(albumId.slice(0, 80));
      if (videoId && !video) dropped.push(videoId.slice(0, 80));
      const page = album ? nextAlbumPage(album.images.map((image) => wasSent(image.url))) : null;
      const images =
        album && page
          ? page.indexes.flatMap((k) => {
              const image = album.images[k];
              return image ? [{ id: `${album.id}:${k}`, url: image.url, label: image.label }] : [];
            })
          : picked.map(({ id, url, label }) => ({ id, url, label }));
      // A link is text the customer opens; an uploaded video goes out as its own message.
      const link = video?.kind === 'link' ? `${video.title}: ${video.url}` : '';
      const text = [normalizeReplyText(args.text ?? ''), link].filter(Boolean).join('\n');
      const videos =
        video?.kind === 'video' ? [{ id: video.id, url: video.url, label: video.label }] : [];
      const extra = dropped.length ? { droppedImageIds: dropped } : {};
      if (!text && !images.length && !videos.length)
        return { content: safeJson({ error: 'nothing_to_send', ...extra }), ok: false };
      const message: OutgoingMessage = {
        ...(text ? { text } : {}),
        images,
        ...(videos.length ? { videos } : {}),
      };
      const outcome: { delivered: number; complete?: boolean } = sink
        ? await sink.send(message)
        : { delivered: 1 };
      const delivered = outcome.delivered;
      if (delivered <= 0)
        return { content: safeJson({ error: 'not_delivered', ...extra }), ok: false };
      state.sent.push({ text, images, ...(videos.length ? { videos } : {}), via: 'send_message' });
      const albumResult = page
        ? {
            album: {
              sent: images.length,
              remaining: page.remaining,
              ...(page.restarted ? { restarted: true } : {}),
            },
          }
        : {};
      return {
        content: safeJson({
          status: 'sent',
          delivered,
          ...albumResult,
          ...(video ? { video: video.kind } : {}),
          // Part of it did not go out (e.g. Meta rejected the video): kept in the turn trace.
          ...(outcome.complete === false ? { incomplete: true } : {}),
          ...extra,
        }),
      };
    },
  };
```

- [ ] **Step 5: Wire it through the pipeline**

In `apps/backend/src/modules/ai/application/reply-pipeline.ts`:
- Delete line 16 (`import { productImages } …`).
- Add to the `turnTools` options type: `/** Attachment URLs already sent in this conversation (album paging). */ sentMediaUrls?: readonly string[];`.
- Replace `allowlist.add(productImages(products));` (line 85) with `allowlist.addProducts(products);`.
- Replace the `outputTools({ … })` argument (lines 92–97) with:

```ts
    outputTools({
      ...(opts.sink ? { sink: opts.sink } : {}),
      allowlist,
      state: opts.output,
      sendMessage: opts.sendMessage,
      ...(opts.sentMediaUrls ? { sentMediaUrls: opts.sentMediaUrls } : {}),
    }),
```

In `apps/backend/src/modules/ai/application/playground.service.ts`:
- After `const allowlist = new ImageAllowlist(initialAllowed, this.mediaBase);` (line 271) add `allowlist.addMedia(focus);`.
- Replace line 274 with `allowlist.addProducts(await catalog.getBotProductsByIds(ws, scope, carryIds));`.
- In the `turnTools({ … })` call (line 395) add after `requests: requestTool,`:

```ts
      // Channels pass what the conversation already received; the playground sends its own list.
      sentMediaUrls: options.sentMediaUrls ?? input.sentMediaUrls ?? [],
```

In `apps/backend/src/modules/ai/application/trace-detail.ts` replace the `case SEND_MESSAGE_TOOL:` block (lines 165–173) with:

```ts
    case SEND_MESSAGE_TOOL: {
      const album = result && isObject(result.album) ? result.album : null;
      detail = result
        ? {
            chars: str(args.text)?.length ?? 0,
            imageCount: arr(args.imageIds).length,
            droppedImages: arr(result.droppedImageIds).length,
            delivered: result.status === 'sent',
            ...(str(args.albumId)
              ? {
                  album: true,
                  albumSent: num(album?.sent) ?? 0,
                  albumRemaining: num(album?.remaining) ?? 0,
                }
              : {}),
            ...(str(args.videoId) ? { video: true } : {}),
            ...(result.incomplete === true ? { incomplete: true } : {}),
          }
        : null;
      break;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai`
Expected: PASS (including `image-replies.spec.ts`, whose exact `{status, delivered, droppedImageIds}` results are unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/ai/ai.schema.ts apps/backend/src/modules/ai
git commit -m "feat(ai): send_message albumId pages and videoId for lodging folders (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Conversation delivery — album cap 8, video messages, history note, already-sent media

**Files:**
- Modify: `apps/backend/src/modules/conversation/api/conversation.facade.ts:99-108, 119-121`
- Modify: `apps/backend/src/modules/conversation/api/index.ts:1-8`
- Modify: `apps/backend/src/modules/conversation/application/conversation.facade.impl.ts:625-648`
- Modify: `apps/backend/src/modules/conversation/application/jobs/reply-delivery.ts:19, 112-155, 268-309`
- Modify: `apps/backend/src/modules/conversation/application/jobs/reply-turns.ts:1-44, 72-84`
- Modify: `apps/backend/src/modules/conversation/application/jobs/meta-inbox.processor.ts:17, 290-310`
- Test: `apps/backend/src/modules/conversation/__tests__/conversation.facade.spec.ts:325-375`, `meta-inbox.processor.spec.ts:733`, `meta-inbox.delivery.spec.ts` (append), `reply-turns.spec.ts` (append)

**Interfaces:**
- Consumes (Task 6): `OutgoingMessage.videos`, `ReplyOptions.sentMediaUrls`.
- Produces:
  - `interface BotAttachment { type: 'image' | 'video'; url: string }` (exported from `conversation/api`).
  - `ConversationFacade.commitBotAttachments(ws, id, { attachments: readonly BotAttachment[]; idempotencyKey: string }): Promise<InboxMessageDto | null>` — replaces `commitBotImages`; 1–10 https URLs, a video always alone.
  - `MAX_BOT_IMAGES = 8` (exported from `reply-delivery.ts`); video key `<send key>:vid`.
  - `outboundAttachmentNote(text, attachments, sender: 'bot' | 'human'): string`; `SENT_MEDIA_WINDOW_MS = 2_592_000_000`; `sentBotMediaUrls(stored: readonly InboxMessageDto[], now: Date): string[]`.

- [ ] **Step 1: Write the failing facade tests**

In `apps/backend/src/modules/conversation/__tests__/conversation.facade.spec.ts` replace the two tests `'sends a bot image as an image attachment, once per key, only while the bot holds control'` and `'rejects a bot image that is not https or when the 24-hour window is closed'` (lines 325–375) with:

```ts
  it('sends a bot image as an image attachment, once per key, only while the bot holds control', async () => {
    const c = await service.receive(ws, channelId, event());
    const reply = await service.commitBotReply(ws, c.id, {
      revision: c.revision,
      text: 'Here',
      idempotencyKey: 'bot:in1',
    });
    expect(reply?.status).toBe('sent');
    const url = 'https://img.example.com/a.jpg';
    const input = { attachments: [{ type: 'image' as const, url }], idempotencyKey: 'bot:in1:img1' };
    const first = await service.commitBotAttachments(ws, c.id, input);
    const again = await service.commitBotAttachments(ws, c.id, input);
    expect(first).toMatchObject({
      direction: 'outbound',
      sender: 'bot',
      text: '',
      attachments: [{ type: 'image', url }],
    });
    expect(again).toEqual(first);
    expect(channels.deliver).toHaveBeenCalledTimes(2);
    expect(channels.deliver).toHaveBeenLastCalledWith(
      ws,
      channelId,
      'customer',
      { text: '', attachments: [{ type: 'image', url }] },
      'bot:in1:img1',
    );
    await expect(
      service.commitBotAttachments(ws, c.id, {
        ...input,
        attachments: [{ type: 'image', url: 'https://img.example.com/b.jpg' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.update(ws, c.id, { mode: 'human' }, actor);
    expect(
      await service.commitBotAttachments(ws, c.id, {
        attachments: input.attachments,
        idempotencyKey: 'bot:in1:img2',
      }),
    ).toBeNull();
    expect(channels.deliver).toHaveBeenCalledTimes(2);
  });
  it('sends a bot video alone, as a video attachment', async () => {
    const c = await service.receive(ws, channelId, event());
    await service.commitBotReply(ws, c.id, {
      revision: c.revision,
      text: 'Video ạ',
      idempotencyKey: 'bot:in1',
    });
    const url = 'https://rapiz.test/media/lodging/tour.mp4';
    const sent = await service.commitBotAttachments(ws, c.id, {
      attachments: [{ type: 'video', url }],
      idempotencyKey: 'bot:in1:vid',
    });
    expect(sent?.attachments).toEqual([{ type: 'video', url }]);
    await expect(
      service.commitBotAttachments(ws, c.id, {
        attachments: [
          { type: 'video', url },
          { type: 'image', url: 'https://img.example.com/a.jpg' },
        ],
        idempotencyKey: 'k3',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('rejects a bot attachment that is not https or when the 24-hour window is closed', async () => {
    const c = await service.receive(ws, channelId, event());
    await expect(
      service.commitBotAttachments(ws, c.id, {
        attachments: [{ type: 'image', url: 'http://x.example/a.jpg' }],
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    vi.advanceTimersByTime(86400000);
    await expect(
      service.commitBotAttachments(ws, c.id, {
        attachments: [{ type: 'image', url: 'https://x.example/a.jpg' }],
        idempotencyKey: 'k2',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });
```

In `apps/backend/src/modules/conversation/__tests__/meta-inbox.processor.spec.ts:733` change `vi.spyOn(inbox, 'commitBotImages')` to `vi.spyOn(inbox, 'commitBotAttachments')`.

- [ ] **Step 2: Write the failing delivery and history tests**

Append to `apps/backend/src/modules/conversation/__tests__/meta-inbox.delivery.spec.ts`:

```ts
describe('MetaInboxProcessor — albums and videos (T-192)', () => {
  const photos = Array.from({ length: 10 }, (_, i) => ({
    id: `a:villa:0:${i}`,
    url: `https://img.example.com/p${i}.jpg`,
    label: `p${i}`,
  }));
  const video = { id: 'v:villa:1:0', url: 'https://rapiz.test/media/lodging/tour.mp4', label: 'Tour' };

  it('sends up to 8 pictures as one album message', async () => {
    const { ai, channels, keys, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Dạ ảnh phòng ngủ ạ', images: photos });
      return answer('');
    });
    await run(job('a1', 'cho xem phòng ngủ'));
    expect(keys()).toEqual(['bot:a1:s1', 'bot:a1:s1:img']);
    expect(vi.mocked(channels.deliver).mock.calls[1]![3].attachments).toEqual(
      photos.slice(0, 8).map((p) => ({ type: 'image', url: p.url })),
    );
  });

  it('sends a video as its own message after the text and pictures', async () => {
    const { ai, channels, keys, run } = setup();
    let result: { delivered: number; complete?: boolean } | undefined;
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      result = await options.sink!.send({ text: 'Dạ video ạ', images: pics, videos: [video] });
      return answer('');
    });
    await run(job('a2', 'có video không'));
    expect(keys()).toEqual(['bot:a2:s1', 'bot:a2:s1:img', 'bot:a2:s1:vid']);
    expect(vi.mocked(channels.deliver).mock.calls[2]![3]).toEqual({
      text: '',
      attachments: [{ type: 'video', url: video.url }],
    });
    expect(result).toEqual({ delivered: 3, complete: true });
  });

  it('keeps the text when Meta rejects the video, and reports the send incomplete', async () => {
    const { ai, channels, keys, run } = setup();
    vi.mocked(channels.deliver)
      .mockResolvedValueOnce({ externalId: 'x1', status: 'sent', failureCode: null })
      .mockResolvedValueOnce({ externalId: null, status: 'failed', failureCode: 'provider_rejected' });
    let result: { delivered: number; complete?: boolean } | undefined;
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      result = await options.sink!.send({ text: 'Dạ video ạ', images: [], videos: [video] });
      return answer('');
    });
    await run(job('a3', 'gửi video'));
    expect(keys()).toEqual(['bot:a3:s1', 'bot:a3:s1:vid']);
    expect(result).toEqual({ delivered: 1, complete: false });
  });

  it('passes the attachment URLs the bot already sent to the next turn', async () => {
    const { ai, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ images: pics });
      return answer('');
    });
    await run(job('a4', 'cho xem ảnh'));
    let seen: readonly string[] | undefined;
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      seen = options.sentMediaUrls;
      return answer('Dạ đây ạ');
    });
    await run(job('a5', 'xem thêm'));
    expect(seen).toEqual(pics.map((p) => p.url));
  });
});
```

Append to `apps/backend/src/modules/conversation/__tests__/reply-turns.spec.ts` (extend the import with `sentBotMediaUrls`):

```ts
describe('bot attachments in the history (T-192)', () => {
  it("describes what the bot sent in its own words, never as the customer's", () => {
    const album = {
      ...msg('bot', '', '2026-11-05T01:00:01.000Z'),
      attachments: Array.from({ length: 8 }, (_, i) => ({
        type: 'image' as const,
        url: `https://img.example.com/${i}.jpg`,
      })),
    };
    const video = {
      ...msg('bot', '', '2026-11-05T01:00:02.000Z'),
      attachments: [{ type: 'video' as const, url: 'https://rapiz.test/media/lodging/v.mp4' }],
    };
    const { turns } = toTimedReplyTurns([
      msg('customer', 'cho xem phòng', '2026-11-05T01:00:00.000Z'),
      album,
      video,
      msg('customer', 'xem thêm', '2026-11-05T01:01:00.000Z'),
    ]);
    expect(turns[1]).toEqual({ role: 'bot', content: '[Bot đã gửi 8 ảnh]\n[Bot đã gửi 1 video]' });
    expect(JSON.stringify(turns)).not.toContain('Khách đã gửi kèm');
  });

  it('lists the attachment URLs the bot sent in the last 30 days', () => {
    const at = (iso: string, url: string, sender: 'bot' | 'human' = 'bot') => ({
      ...msg(sender, '', iso),
      attachments: [{ type: 'image' as const, url }],
    });
    const recent = at('2026-11-04T00:00:00.000Z', 'https://img.example.com/new.jpg');
    const stored = [
      at('2026-09-01T00:00:00.000Z', 'https://img.example.com/old.jpg'),
      recent,
      { ...at('2026-11-04T00:00:00.000Z', 'https://img.example.com/failed.jpg'), status: 'failed' as const },
      at('2026-11-04T00:00:00.000Z', 'https://img.example.com/staff.jpg', 'human'),
      recent,
    ];
    expect(sentBotMediaUrls(stored, new Date('2026-11-05T00:00:00.000Z'))).toEqual([
      'https://img.example.com/new.jpg',
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/conversation`
Expected: FAIL — `commitBotAttachments is not a function`, album sliced to 3, no `:vid` key, history note says "Khách đã gửi kèm", `sentBotMediaUrls` missing.

- [ ] **Step 4: Typed attachments in the facade**

In `apps/backend/src/modules/conversation/api/conversation.facade.ts` replace the `commitBotImages` declaration and its comment (lines 99–108) with:

```ts
  /**
   * Attachments of a bot reply as ONE message: several images arrive as a single album (Meta takes
   * up to 10), a video always goes alone (T-192); https URLs only. Same delivery path, idempotency
   * and 24-hour window as the text; null when a human took over meanwhile. A failed send is stored
   * as a failed outbound message and returned, never thrown.
   */
  commitBotAttachments(
    ws: WorkspaceId,
    id: string,
    input: { attachments: readonly BotAttachment[]; idempotencyKey: string },
  ): Promise<InboxMessageDto | null>;
```

and add after `BotQuickReplies` (line 121):

```ts
/** One attachment of a bot message (T-192). */
export interface BotAttachment {
  type: 'image' | 'video';
  url: string;
}
```

In `apps/backend/src/modules/conversation/api/index.ts` add `type BotAttachment,` to the export list.

In `apps/backend/src/modules/conversation/application/conversation.facade.impl.ts` replace `commitBotImages` (lines 625–648) with:

```ts
  async commitBotAttachments(
    ws: WorkspaceId,
    id: string,
    input: { attachments: readonly BotAttachment[]; idempotencyKey: string },
  ): Promise<InboxMessageDto | null> {
    const list = input.attachments;
    if (
      !list.length ||
      list.length > 10 ||
      list.some(
        (a) =>
          (a.type !== 'image' && a.type !== 'video') ||
          !a.url.startsWith('https://') ||
          a.url.length > 2000,
      ) ||
      (list.some((a) => a.type === 'video') && list.length > 1)
    )
      throw new ConversationError(
        'VALIDATION_FAILED',
        'Attachments must be 1-10 https images or one https video',
      );
    // The text reply of the same turn already moved the revision on, so a follow-up only requires
    // that the bot still holds the conversation (a takeover in between wins).
    return this.reserveAndDeliver(
      ws,
      id,
      {
        text: '',
        attachments: list.map((a) => ({ type: a.type, url: a.url })),
        idempotencyKey: input.idempotencyKey,
      },
      null,
      'follow-up',
    );
  }
```

and add `type BotAttachment,` to its import from `'../api/conversation.facade.js'`.

- [ ] **Step 5: Album cap 8 and video delivery**

In `apps/backend/src/modules/conversation/application/jobs/reply-delivery.ts`:
- Replace line 19 with:

```ts
/** T-192 (ADR-026): one album of up to 8 pictures per message (Meta accepts 10). */
export const MAX_BOT_IMAGES = 8;
```

- In `sendMessage` replace the block from `const images = message.images.length > 0;` to the end of the `try { … }` block (lines 128–144) with:

```ts
    const images = message.images.length > 0;
    const video = message.videos?.[0];
    // Complete: every bubble, the album (or a single picture) and the video went out.
    let picturesOut = !images;
    let videoOut = !video;
    const album = async () => {
      const before = this.delivered;
      await this.sendImages(message.images, `${key}:img`);
      picturesOut = this.delivered > before;
    };
    try {
      if (text && images && message.quickReplies?.length) {
        await album();
        if (!this.stop && !(await this.stopForNewer()))
          await this.sendText(text, key, message.quickReplies);
      } else {
        if (text) await this.sendText(text, key, message.quickReplies);
        if (!this.stop && images && !(text && (await this.stopForNewer()))) await album();
      }
      if (video && !this.stop && !(await this.stopForNewer())) {
        const before = this.delivered;
        await this.sendVideo(video.url, `${key}:vid`);
        videoOut = this.delivered > before;
      }
    } catch (error) {
```

  and change the return (line 154) to `return { delivered: this.delivered, complete: !this.stop && picturesOut && videoOut };`. Update the method comment (line 113) to: `One \`send_message\` call: its text bubbles, then its pictures as one album, then its video as its own message. With quick replies the album goes first, so the buttons stay on the last message Messenger shows.`

- In `sendImages` replace the `commitBotImages` call (lines 278–281) with:

```ts
      const result = await this.deps.inbox.commitBotAttachments(job.workspaceId, conversationId, {
        attachments: list.map((url) => ({ type: 'image' as const, url })),
        idempotencyKey,
      });
```

- Add after `sendImages`:

```ts
  /**
   * One video as its own message (Meta fetches it by URL, at most 25 MB). Best effort like the
   * pictures: a failed send is recorded and logged (status or code only), never thrown; a takeover
   * stops the turn.
   */
  private async sendVideo(url: string, key: string): Promise<void> {
    const { job, conversationId } = this.turn;
    try {
      const result = await this.deps.inbox.commitBotAttachments(job.workspaceId, conversationId, {
        attachments: [{ type: 'video', url }],
        idempotencyKey: key,
      });
      if (!result) {
        this.stop = 'takeover';
        return;
      }
      this.committed(result);
      if (result.status === 'sent') this.delivered++;
      else
        this.deps.logger.warn(
          `Meta inbox event ${job.id}: the video was not delivered (${result.failureCode ?? result.status})`,
        );
    } catch (error) {
      this.deps.logger.warn(`Meta inbox event ${job.id}: video not sent (${errorClass(error)})`);
    }
  }
```

- Update the class comment (line 40) to list the keys: `` Keys: `<key>:s<n>` (+ `:t2`… bubbles, `:img` album, `:vid` video) per send, `<key>` for the final. ``

- [ ] **Step 6: History note and already-sent media**

In `apps/backend/src/modules/conversation/application/jobs/reply-turns.ts` add after `withAttachmentNote`:

```ts
/**
 * What the bot or staff sent besides text, in their own words ("[Bot đã gửi 8 ảnh]"), so the
 * model never reads its own album as something the customer sent.
 */
export function outboundAttachmentNote(
  text: string,
  attachments: readonly { type: string }[],
  sender: 'bot' | 'human',
): string {
  if (!attachments.length) return text;
  const images = attachments.filter((a) => a.type === 'image').length;
  const videos = attachments.filter((a) => a.type === 'video').length;
  const others = attachments.length - images - videos;
  const what = [images && `${images} ảnh`, videos && `${videos} video`, others && `${others} tệp`]
    .filter(Boolean)
    .join(' / ');
  return `${text}\n[${sender === 'bot' ? 'Bot' : 'Nhân viên'} đã gửi ${what}]`.trim();
}

/** Bot attachments sent within this window count as already sent for album paging (T-192). */
export const SENT_MEDIA_WINDOW_MS = 30 * 86_400_000;

/** URLs of attachments the bot sent (status `sent`) in the last 30 days, oldest first, unique. */
export function sentBotMediaUrls(stored: readonly InboxMessageDto[], now: Date): string[] {
  const since = now.getTime() - SENT_MEDIA_WINDOW_MS;
  return [
    ...new Set(
      stored
        .filter(
          (m) =>
            m.direction === 'outbound' &&
            m.sender === 'bot' &&
            m.status === 'sent' &&
            Date.parse(m.createdAt) >= since,
        )
        .flatMap((m) => m.attachments.map((a) => a.url)),
    ),
  ];
}
```

and in `toTimedReplyTurns` replace the `const content = withAttachmentNote(…).slice(0, MAX_TURN_CHARS);` statement (lines 78–83) with:

```ts
    const content = (
      m.direction === 'outbound'
        ? outboundAttachmentNote(m.text, m.attachments, m.sender === 'bot' ? 'bot' : 'human')
        : withAttachmentNote(m.text, m.attachments, seen, index < lastOutbound)
    ).slice(0, MAX_TURN_CHARS);
```

In `apps/backend/src/modules/conversation/application/jobs/meta-inbox.processor.ts` change line 17 to `import { sentBotMediaUrls, toTimedReplyTurns } from './reply-turns.js';` and in `generate` → `ask` add to the options object passed to `this.ai.reply` (after `turnTimes: history.times,`):

```ts
          // Every stored message (a re-run's history hides the interrupted run's bot messages).
          sentMediaUrls: sentBotMediaUrls(context.messages, new Date()),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/conversation src/modules/ai`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/conversation
git commit -m "feat(conversation): 8-photo albums, bot video messages and own-wording history (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Prompt `sales-agent@20`, album evals, playground videos and paging

**Files:**
- Create: `packages/ai-core/prompts/sales-agent@20.md` (copy of `@18` with three edits)
- Modify: `apps/backend/src/modules/ai/application/playground.service.ts:139-158`
- Modify: `apps/backend/src/cli/eval.ts:41`
- Modify: `apps/backend/src/modules/ai/evals/case.ts:198-246`, `apps/backend/src/modules/ai/evals/runner.ts:307-313`
- Create: `apps/backend/evals/lodging/hotel-a17-album-first-page.yaml`, `apps/backend/evals/lodging/hotel-a17-album-next-page.yaml`
- Modify (tests): `apps/backend/src/modules/ai/__tests__/playground.spec.ts:670, 708-726, 743-757, 819`, `industry-wiring.spec.ts:96-100`, `evals.spec.ts:245`
- Modify: `apps/web/src/features/ai/api/playground.ts:11-28`, `apps/web/src/features/ai/components/test-chat-images.tsx` (new export), `apps/web/src/features/ai/components/test-chat.tsx:116-145, 239-246`
- Test: `apps/web/src/features/ai/components/test-chat.test.tsx` (one new `it`)

**Interfaces:**
- Consumes (Task 6): `send_message` `albumId` / `videoId`, `PlaygroundRequest.sentMediaUrls`, `PlaygroundResponse.messages[].videos`.
- Produces: `SalesPromptVersion` includes `20`; `PROMPT_BY_INDUSTRY.hotel === 20`; eval case field `sent_media: string[]` (default `[]`) passed as `PlaygroundRequest.sentMediaUrls`; web `PlaygroundTurn.sentMediaUrls?: string[]`; `BotVideos({ videos })`.

- [ ] **Step 1: Write the failing prompt and wiring tests**

In `apps/backend/src/modules/ai/__tests__/playground.spec.ts`:
- Lines 670, 711 and 819: change `'sales-agent@18'` to `'sales-agent@20'`.
- Rename the test at line 708 to `'uses lodging prompt 20 and the profile block for hotel bots by default'` and add inside it, after `expect(system).toContain('no_draft → the summary is gone, so prepare the hold again');`:

```ts
    expect(system).toContain('send it with send_message albumId');
    expect(system).toContain('Send a video (videoId) only when the customer asks for a video');
```

- Add after the test `'keeps prompt 18 equal to prompt 17 outside the lodging section'`:

```ts
  it('keeps prompt 20 equal to prompt 18 except the picture rules', async () => {
    const { PROMPTS_DIR } = await import('@agent-sales/ai-core');
    const { readFile } = await import('node:fs/promises');
    const p18 = (await readFile(`${PROMPTS_DIR}/sales-agent@18.md`, 'utf8')).split('\n');
    const p20 = (await readFile(`${PROMPTS_DIR}/sales-agent@20.md`, 'utf8')).split('\n');
    const pictureRule = (line: string) =>
      line.startsWith('- send_message sends a message right away') ||
      line.startsWith('- When you present one or more specific products') ||
      line.startsWith('- Photos and videos of a property are kept in folders');
    expect(p20.filter((l) => !pictureRule(l))).toEqual(p18.filter((l) => !pictureRule(l)));
    expect(p20.filter(pictureRule)).toHaveLength(3);
  });
```

In `apps/backend/src/modules/ai/__tests__/industry-wiring.spec.ts` replace lines 96–100 with:

```ts
  it('maps the request industries to @19, hotel to @20 and the rest to @15', async () => {
    expect(PROMPT_BY_INDUSTRY).toMatchObject({ saas: 19, education: 19, spa: 19, hotel: 20 });
    for (const industry of ['saas', 'education', 'spa'])
      expect((await turn(industry)).promptVersion, industry).toBe('sales-agent@19');
    expect((await turn('hotel')).promptVersion).toBe('sales-agent@20');
```

In `apps/backend/src/modules/ai/__tests__/evals.spec.ts:245` change `'sales-agent@18'` to `'sales-agent@20'`.

- [ ] **Step 2: Write the failing eval cases**

Create `apps/backend/evals/lodging/hotel-a17-album-first-page.yaml`:

```yaml
id: hotel-a17-album-first-page
group: lodging-a17
tags: [critical]
bot:
  industry: hotel
  name: Test lodging assistant
  profile:
    fields:
      displayName: Test lodging business
    notes: ''
products:
  - name: 'A17 – Villa A17'
    code: A17
    description: 'Một căn nguyên căn, có bể bơi và 8 phòng ngủ.'
    variants:
      - name: 'Nguyên căn, giá tham khảo'
        price: 12000000
        stock: 0
    accommodation:
      rentalType: entire_property
      code: A17
      bedrooms: 1
      standardAdults: 24
      standardChildren: 8
      childAgeBelow: 6
      maxGuests: null
      roomLayout:
        - { name: 'Nguyên căn', beds: 'Beds described by owner' }
      amenities: ['Bể bơi']
      rateBasis: night
      rates:
        - { days: [1, 2, 3, 4, 5, 6, 7], amount: 12000000 }
      gallery: []
      albums:
        - id: outdoor
          name: 'Ngoài trời ban ngày'
          items:
            - { kind: image, url: 'https://media.rapiz.test/a17/out-0.jpg', caption: 'Bể bơi' }
            - { kind: image, url: 'https://media.rapiz.test/a17/out-1.jpg', caption: '' }
        - id: bedrooms
          name: 'Phòng ngủ'
          items:
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-0.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-1.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-2.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-3.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-4.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-5.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-6.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-7.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-8.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-9.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-10.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-11.jpg', caption: '' }
conversation:
  - customer: 'Cho em xem ảnh phòng ngủ A17 với'
# The customer asks for the bedrooms: the bot picks the "Phòng ngủ" folder and the server sends its
# first 8 photos in one album; the bot offers the rest instead of sending all 12.
expect:
  outcome: answered
  steps_succeeded: [search_products, send_message]
  images_min: 8
  images_per_message_max: 8
  not_contains: ['https://', 'media.rapiz.test']
fake_turns:
  - tool_calls:
      - { name: search_products, input: { query: 'A17 phòng ngủ' } }
  - tool_calls:
      - name: send_message
        input: { text: 'Dạ em gửi ảnh phòng ngủ A17 ạ', albumId: 'a:eval-product-1:1' }
  - text: 'Dạ phòng ngủ còn ảnh nữa, em gửi tiếp nhé?'
```

Create `apps/backend/evals/lodging/hotel-a17-album-next-page.yaml` (same property; the first 8 bedroom photos already went out):

```yaml
id: hotel-a17-album-next-page
group: lodging-a17
tags: [critical]
bot:
  industry: hotel
  name: Test lodging assistant
  profile:
    fields:
      displayName: Test lodging business
    notes: ''
products:
  - name: 'A17 – Villa A17'
    code: A17
    description: 'Một căn nguyên căn, có bể bơi và 8 phòng ngủ.'
    variants:
      - name: 'Nguyên căn, giá tham khảo'
        price: 12000000
        stock: 0
    accommodation:
      rentalType: entire_property
      code: A17
      bedrooms: 1
      standardAdults: 24
      standardChildren: 8
      childAgeBelow: 6
      maxGuests: null
      roomLayout:
        - { name: 'Nguyên căn', beds: 'Beds described by owner' }
      amenities: ['Bể bơi']
      rateBasis: night
      rates:
        - { days: [1, 2, 3, 4, 5, 6, 7], amount: 12000000 }
      gallery: []
      albums:
        - id: outdoor
          name: 'Ngoài trời ban ngày'
          items:
            - { kind: image, url: 'https://media.rapiz.test/a17/out-0.jpg', caption: 'Bể bơi' }
            - { kind: image, url: 'https://media.rapiz.test/a17/out-1.jpg', caption: '' }
        - id: bedrooms
          name: 'Phòng ngủ'
          items:
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-0.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-1.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-2.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-3.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-4.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-5.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-6.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-7.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-8.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-9.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-10.jpg', caption: '' }
            - { kind: image, url: 'https://media.rapiz.test/a17/bed-11.jpg', caption: '' }
sent_media:
  - 'https://media.rapiz.test/a17/bed-0.jpg'
  - 'https://media.rapiz.test/a17/bed-1.jpg'
  - 'https://media.rapiz.test/a17/bed-2.jpg'
  - 'https://media.rapiz.test/a17/bed-3.jpg'
  - 'https://media.rapiz.test/a17/bed-4.jpg'
  - 'https://media.rapiz.test/a17/bed-5.jpg'
  - 'https://media.rapiz.test/a17/bed-6.jpg'
  - 'https://media.rapiz.test/a17/bed-7.jpg'
conversation:
  - customer: 'Cho em xem ảnh phòng ngủ A17 với'
  - bot: 'Dạ em gửi ảnh phòng ngủ A17 ạ. Phòng ngủ còn ảnh nữa, em gửi tiếp nhé?'
  - customer: 'xem thêm'
# "xem thêm" after the first page: the same album sends only the 4 photos not sent yet.
expect:
  outcome: answered
  steps_succeeded: [search_products, send_message]
  images_min: 4
  images_per_message_max: 4
fake_turns:
  - tool_calls:
      - { name: search_products, input: { query: 'A17 phòng ngủ' } }
  - tool_calls:
      - name: send_message
        input: { text: 'Dạ em gửi thêm ảnh phòng ngủ ạ', albumId: 'a:eval-product-1:1' }
  - text: 'Dạ đây là các ảnh phòng ngủ còn lại ạ.'
```


- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai/__tests__/playground.spec.ts src/modules/ai/__tests__/industry-wiring.spec.ts src/modules/ai/__tests__/evals.spec.ts`
Expected: FAIL — prompt `sales-agent@20` missing / hotel still on @18; `sent_media` rejected by the strict case schema.

- [ ] **Step 4: Write `sales-agent@20`**

Run: `cp packages/ai-core/prompts/sales-agent@18.md packages/ai-core/prompts/sales-agent@20.md`, then with the Edit tool make three replacements in `sales-agent@20.md`:

1. Replace the line starting `- send_message sends a message right away` (line 33) with:

```
- send_message sends a message right away, while you keep working: use it to send pictures and videos. Look things up first, then answer; never send a message only to say you are looking. Each call takes optional text and either up to 3 image ids or one albumId, plus at most one videoId; call it several times for more pictures, for example once per product with a line naming it. Never repeat in your answer what send_message already sent.
```

2. Replace the line starting `- When you present one or more specific products` (line 34) with:

```
- When you present one or more specific products, send their pictures with send_message (prefer the product you recommend most); when the customer asks to see a product, always send its pictures if it has any. Image ids come from the "images" of product details and <focus_products> and from the "Images you may send" list; album ids from their "albums" and video ids from their "videos". Never write URLs and never invent ids. Never say a product has no picture when its details list images or albums.
```

3. After the line starting `- Missing check-in times, deposits, refunds` (line 58, the last line of "Lodging facts and decisions:") insert this new line:

```
- Photos and videos of a property are kept in folders: the "albums" of its product details (for example "Phòng ngủ" or "Ngoài trời ban đêm"), summarised under accommodation.albums. When the customer asks to see photos, pick the folder whose name fits the request and send it with send_message albumId; the server sends the next 8 photos of that folder the customer has not received yet, in the owner's order. Its result tells you remaining: when remaining is above 0, offer the rest in one short line (for example "Dạ còn R ảnh nữa, {{bot.selfPronoun}} gửi tiếp nhé?" with R from the result) and send the same albumId again when the customer wants more. When no folder fits, send the closest one or ask which part of the property the customer wants to see. Send a video (videoId) only when the customer asks for a video or a clip, or when the matching folder holds only videos. Never paste a media URL yourself.
```

- [ ] **Step 5: Wire the version, the eval field and the CLI**

In `apps/backend/src/modules/ai/application/playground.service.ts`: change `hotel: 18,` (line 140) to `hotel: 20,` with the comment `// @18 + lodging media folders: albums by albumId, videos only on request (T-192).`; change `export type SalesPromptVersion = 13 | 14 | 15 | 16 | 17 | 18 | 19;` to `… | 19 | 20;`.

In `apps/backend/src/cli/eval.ts:41` change the list to `[13, 14, 15, 16, 17, 18, 19, 20]`.

In `apps/backend/src/modules/ai/evals/case.ts` add to `EvalCase` (after `requests_before`):

```ts
    /**
     * Attachment URLs the bot already sent in this conversation before the turn (album paging,
     * T-192): an `albumId` send skips them. The runner passes them as `sentMediaUrls`.
     */
    sent_media: z.array(z.string().url()).max(200).default([]),
```

In `apps/backend/src/modules/ai/evals/runner.ts` replace `request` (lines 307–313) with:

```ts
const request = (c: EvalCase): PlaygroundRequest => ({
  messages: c.conversation.map((turn) =>
    'customer' in turn
      ? { role: 'customer' as const, content: turn.customer }
      : { role: 'bot' as const, content: turn.bot },
  ),
  ...(c.sent_media.length ? { sentMediaUrls: c.sent_media } : {}),
});
```

- [ ] **Step 6: Run the backend tests to verify they pass**

Run: `pnpm --filter @agent-sales/backend exec vitest run src/modules/ai`
Expected: PASS, both new eval cases included (`evals.spec.ts` runs every case in fake mode).

- [ ] **Step 7: Write the failing playground web test**

Add to `apps/web/src/features/ai/components/test-chat.test.tsx` (inside `describe('TestChat', …)`):

```tsx
  it('tells the next turn which pictures the bot already sent, and plays bot videos', async () => {
    const first = {
      ...reply,
      reply: 'Dạ ảnh ạ',
      images: [{ url: 'https://rapiz.test/media/a.jpg', label: 'A' }],
      messages: [
        {
          text: 'Dạ ảnh ạ',
          images: [{ id: 'a:v:0:0', url: 'https://rapiz.test/media/a.jpg', label: 'A' }],
          videos: [{ id: 'v:v:1:0', url: 'https://rapiz.test/media/lodging/t.mp4', label: 'Tour' }],
          via: 'send_message',
        },
      ],
    };
    const { fetchStub, calls } = stubFetch({
      [`POST /bots/${botId}/playground`]: { status: 200, body: first },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="" />);

    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'cho xem phòng{Enter}');
    expect(await screen.findByLabelText('Tour')).toHaveAttribute(
      'src',
      'https://rapiz.test/media/lodging/t.mp4',
    );
    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'xem thêm{Enter}');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]?.body).not.toHaveProperty('sentMediaUrls');
    expect(calls[1]?.body).toMatchObject({ sentMediaUrls: ['https://rapiz.test/media/a.jpg'] });
  });
```

Run: `pnpm --filter @agent-sales/web exec vitest run src/features/ai/components/test-chat.test.tsx`
Expected: FAIL — no element labelled "Tour"; no `sentMediaUrls`.

- [ ] **Step 8: Render videos and send the already-sent list**

In `apps/web/src/features/ai/api/playground.ts` add to `PlaygroundTurn`:

```ts
  /** Pictures the bot already sent in this test chat, so an album sends the next ones. */
  sentMediaUrls?: string[] | undefined;
```

and change the mutation to:

```ts
    mutationFn: ({ messages, images, sentMediaUrls }: PlaygroundTurn) =>
      api(`/bots/${botId}/playground`, PlaygroundResponse, {
        method: 'POST',
        body: {
          messages: messages.slice(-REPLY_HISTORY_MAX_TURNS),
          ...(images?.length ? { images } : {}),
          ...(sentMediaUrls?.length ? { sentMediaUrls: sentMediaUrls.slice(-200) } : {}),
        },
      }),
```

Append to `apps/web/src/features/ai/components/test-chat-images.tsx`:

```tsx
/** Videos the bot sends, each as its own message (lodging folders, T-192). */
export function BotVideos({ videos }: { videos: readonly { url: string; label: string }[] }) {
  if (!videos.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {videos.map((video) => (
        <video
          key={video.url}
          src={video.url}
          controls
          preload="metadata"
          aria-label={video.label}
          className="max-h-64 w-full max-w-xs rounded-lg border bg-muted"
        />
      ))}
    </div>
  );
}
```

In `apps/web/src/features/ai/components/test-chat.tsx`:
- Change the import on line 25 to `import { AttachmentThumbs, BotImages, BotVideos } from './test-chat-images';`.
- In `dispatch`, after `const messages = [ … ];` add:

```tsx
    // The playground stores no conversation: it tells the server what the bot already sent.
    const sentMediaUrls = turns.flatMap(
      (h) =>
        h.result?.messages?.flatMap((m) => m.images.map((i) => i.url)) ??
        h.result?.images.map((i) => i.url) ??
        [],
    );
```

  and change `playground.mutate({ messages, images }, …)` to `playground.mutate({ messages, images, sentMediaUrls }, …)`.
- In the per-message render, after the `{message.images.length ? ( … ) : null}` block, add:

```tsx
                            {message.videos?.length ? (
                              <div className="mt-0.5">
                                <BotVideos videos={message.videos} />
                              </div>
                            ) : null}
```

- [ ] **Step 9: Run the web test to verify it passes**

Run: `pnpm --filter @agent-sales/web exec vitest run src/features/ai`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/ai-core/prompts/sales-agent@20.md apps/backend/src/modules/ai apps/backend/src/cli/eval.ts apps/backend/evals/lodging apps/web/src/features/ai
git commit -m "feat(ai): sales-agent@20 for hotels with folder albums, album evals, playground videos (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Live eval check (prompt change rule)**

Rule 05 requires the evals when a prompt changes. With an LLM configured in the dev database run:
`pnpm --filter @agent-sales/backend eval --live --group lodging-a17` and `pnpm --filter @agent-sales/backend eval --live --group lodging-holds`
Expected: the gate passes; record the summary lines for the PR. If no live LLM is reachable, say so in the PR instead of claiming the live run.

---

### Task 9: Web plumbing — `@dnd-kit`, `apiUpload` with progress, video upload hook, gallery model

**Files:**
- Modify: `apps/web/package.json` (dependencies), `pnpm-lock.yaml`
- Modify: `apps/web/src/lib/api-client.ts` (append `apiUpload`)
- Modify: `apps/web/src/lib/api-client.test.ts` (append a `describe`)
- Create: `apps/web/src/features/lodging/api/media.ts`
- Create: `apps/web/src/features/lodging/lib/gallery-model.ts`, `apps/web/src/features/lodging/lib/gallery-model.test.ts`

**Interfaces:**
- Consumes (Task 1): `GalleryFolder`, `GalleryItem`, `galleryCoverUrl`, `folderNameKey`, `GALLERY_MAX_FOLDERS`, `GALLERY_MAX_ITEMS`, `UploadLodgingVideoResponse`.
- Produces:
  - `apiUpload<T>(path: string, schema: z.ZodType<T>, init: { file: Blob; fileName: string; workspaceId?: string; onProgress?: (p: { loaded: number; total: number }) => void; signal?: AbortSignal }): Promise<T>`.
  - `useUploadLodgingVideo(): (file: File, onProgress: (fraction: number) => void) => Promise<UploadLodgingVideoResponse>`; `videoUploadErrorKey(error: unknown): 'lodging.media.videoTooLarge' | 'lodging.media.videoInvalid' | 'lodging.media.storageUnavailable' | 'lodging.media.uploadFailed'`.
  - `gallery-model.ts`: `GalleryDraft { gallery: GalleryFolder[]; galleryCover: string }`, `GalleryImageUpload = (file: File) => Promise<string>`, `class GalleryUploadError extends Error`, `cloneGallery`, `totalItems`, `remainingItems`, `canAddFolder`, `coverOf`, `nameTaken(d, name, exceptId?)`, `addFolder(d, name, id?)`, `renameFolder(d, id, name)`, `moveFolder(d, id, delta)`, `deleteFolder(d, id)`, `appendItems(d, folderId, items)`, `reorderItems(d, folderId, from, to)`, `moveItem(d, folderId, index, delta)`, `moveItemsTo(d, fromId, indexes, toId)`, `removeItems(d, folderId, indexes)`, `setCaption(d, folderId, index, caption)`, `setCover(d, url)`, `folderCounts(f)`, `folderThumb(f)`, `imageNumbers(items)`, `itemKeys(items)`, `hostOf(url)`.

- [ ] **Step 1: Add the drag-and-drop packages**

Run: `pnpm --filter @agent-sales/web add --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2`
Expected: `apps/web/package.json` lists the three exact versions (published Dec 2024, React ≥ 16.8 peers, so React 19 is fine); `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing model and upload tests**

Create `apps/web/src/features/lodging/lib/gallery-model.test.ts`:

```ts
import type { GalleryFolder, GalleryItem } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import {
  addFolder,
  appendItems,
  coverOf,
  deleteFolder,
  folderCounts,
  type GalleryDraft,
  imageNumbers,
  itemKeys,
  moveFolder,
  moveItemsTo,
  remainingItems,
  removeItems,
  renameFolder,
  reorderItems,
  setCover,
} from './gallery-model';

const img = (n: number): GalleryItem => ({ kind: 'image', url: `https://cdn.example.com/${n}.jpg`, caption: '' });
const link: GalleryItem = { kind: 'link', url: 'https://youtu.be/x', caption: '' };
const folder = (id: string, name: string, items: GalleryItem[] = []): GalleryFolder => ({ id, name, items });
const draft = (gallery: GalleryFolder[], galleryCover = ''): GalleryDraft => ({ gallery, galleryCover });

describe('gallery folders', () => {
  it('adds a trimmed folder and refuses a duplicate name, an empty name or a 21st folder', () => {
    const one = addFolder(draft([]), '  Phòng ngủ ', 'a');
    expect(one.gallery).toEqual([folder('a', 'Phòng ngủ')]);
    expect(addFolder(one, 'phòng NGỦ', 'b')).toBe(one);
    expect(addFolder(one, '   ', 'b')).toBe(one);
    const full = draft(Array.from({ length: 20 }, (_, i) => folder(`f${i}`, `F${i}`)));
    expect(addFolder(full, 'Mới', 'x')).toBe(full);
  });

  it('renames unless the name is taken, and moves folders within bounds', () => {
    const d = draft([folder('a', 'A'), folder('b', 'B')]);
    expect(renameFolder(d, 'a', 'b')).toBe(d);
    expect(renameFolder(d, 'a', 'Sân').gallery[0]?.name).toBe('Sân');
    expect(moveFolder(d, 'b', -1).gallery.map((f) => f.id)).toEqual(['b', 'a']);
    expect(moveFolder(d, 'a', -1).gallery.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('clears a chosen cover when its folder or photo goes away', () => {
    const d = draft([folder('a', 'A', [img(1), img(2)]), folder('b', 'B', [img(3)])], img(2).url);
    expect(deleteFolder(d, 'b').galleryCover).toBe(img(2).url);
    expect(deleteFolder(d, 'a').galleryCover).toBe('');
    expect(removeItems(d, 'a', [1]).galleryCover).toBe('');
    expect(coverOf(removeItems(d, 'a', [1]))).toBe(img(1).url);
    expect(setCover(d, img(3).url).galleryCover).toBe(img(3).url);
  });
});

describe('gallery items', () => {
  it('appends up to 200 items for the whole property', () => {
    const d = draft([folder('a', 'A', Array.from({ length: 198 }, (_, i) => img(i)))]);
    expect(remainingItems(d)).toBe(2);
    expect(appendItems(d, 'a', [img(1), img(2), img(3)]).gallery[0]?.items).toHaveLength(200);
  });

  it('reorders, moves selected items to the end of another folder and removes them', () => {
    const d = draft([folder('a', 'A', [img(1), img(2), img(3)]), folder('b', 'B', [img(9)])]);
    expect(reorderItems(d, 'a', 2, 0).gallery[0]?.items.map((i) => i.url)).toEqual([
      img(3).url,
      img(1).url,
      img(2).url,
    ]);
    const moved = moveItemsTo(d, 'a', [0, 2], 'b');
    expect(moved.gallery[0]?.items).toEqual([img(2)]);
    expect(moved.gallery[1]?.items).toEqual([img(9), img(1), img(3)]);
  });

  it('numbers photos only, counts kinds and keys repeated urls apart', () => {
    const items = [img(1), link, img(1), { kind: 'video' as const, url: '/media/x.mp4', caption: '' }];
    expect(imageNumbers(items)).toEqual([1, null, 2, null]);
    expect(folderCounts(folder('a', 'A', items))).toEqual({ images: 2, videos: 1, links: 1 });
    expect(itemKeys(items)).toEqual([img(1).url, link.url, `${img(1).url}#1`, '/media/x.mp4']);
  });
});
```

Append to `apps/web/src/lib/api-client.test.ts` (extend the import with `apiUpload`):

```ts
/** A scripted XMLHttpRequest: reports 50 % upload progress, then answers the next response. */
class FakeXhr {
  static responses: { status: number; body: string }[] = [];
  static sent: FakeXhr[] = [];
  headers: Record<string, string> = {};
  url = '';
  withCredentials = false;
  status = 0;
  statusText = '';
  responseText = '';
  body: FormData | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } =
    { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {
    this.onabort?.();
  }
  send(body: FormData) {
    this.body = body;
    FakeXhr.sent.push(this);
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    const next = FakeXhr.responses.shift() ?? { status: 500, body: '' };
    this.status = next.status;
    this.responseText = next.body;
    queueMicrotask(() => this.onload?.());
  }
}

describe('apiUpload()', () => {
  const Schema = z.object({ url: z.string() });
  const file = new Blob(['mp4'], { type: 'video/mp4' });

  it('posts one multipart file with the token and workspace headers, reporting progress', async () => {
    FakeXhr.sent = [];
    FakeXhr.responses = [{ status: 201, body: JSON.stringify({ url: '/media/v.mp4' }) }];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    setAccessToken('t1');
    const progress: number[] = [];
    await expect(
      apiUpload('/lodging/media/videos', Schema, {
        file,
        fileName: 'tour.mp4',
        workspaceId: 'ws-9',
        onProgress: ({ loaded, total }) => progress.push(loaded / total),
      }),
    ).resolves.toEqual({ url: '/media/v.mp4' });
    const xhr = FakeXhr.sent[0];
    expect(xhr?.url).toBe('/api/v1/lodging/media/videos');
    expect(xhr?.withCredentials).toBe(true);
    expect(xhr?.headers).toMatchObject({ Authorization: 'Bearer t1', 'X-Workspace-Id': 'ws-9' });
    expect(xhr?.body?.get('file')).toBeInstanceOf(Blob);
    expect(progress).toEqual([0.5]);
  });

  it('answers the error envelope as an ApiClientError', async () => {
    FakeXhr.sent = [];
    FakeXhr.responses = [
      {
        status: 413,
        body: JSON.stringify({
          error: { code: 'VALIDATION_FAILED', message: 'too large', details: { reason: 'VIDEO_TOO_LARGE' }, traceId: 't' },
        }),
      },
    ];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const error = await apiUpload('/lodging/media/videos', Schema, { file, fileName: 'a.mp4' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 413, details: { reason: 'VIDEO_TOO_LARGE' } });
  });

  it('refreshes the session once on 401 and retries', async () => {
    FakeXhr.sent = [];
    FakeXhr.responses = [
      { status: 401, body: '' },
      { status: 201, body: JSON.stringify({ url: '/media/v.mp4' }) },
    ];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const { fetchStub } = stubFetch({ 'POST /auth/refresh': { status: 200, body: refreshed } });
    vi.stubGlobal('fetch', fetchStub);
    setAccessToken('old');
    await expect(apiUpload('/lodging/media/videos', Schema, { file, fileName: 'a.mp4' })).resolves.toEqual({
      url: '/media/v.mp4',
    });
    expect(FakeXhr.sent[1]?.headers['Authorization']).toBe('Bearer new-token');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/web exec vitest run src/lib/api-client.test.ts src/features/lodging/lib/gallery-model.test.ts`
Expected: FAIL — `apiUpload` and `./gallery-model` do not exist.

- [ ] **Step 4: Implement `apiUpload`**

Append to `apps/web/src/lib/api-client.ts`:

```ts
export interface UploadProgress {
  loaded: number;
  total: number;
}

interface UploadInit {
  file: Blob;
  fileName: string;
  workspaceId?: string | undefined;
  onProgress?: ((progress: UploadProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** One XHR attempt (fetch reports no upload progress). Resolves with the raw answer. */
function sendUpload(
  path: string,
  init: UploadInit,
  scope: string | null,
): Promise<{ status: number; statusText: string; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    if (scope) xhr.setRequestHeader('X-Workspace-Id', scope);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) init.onProgress?.({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () =>
      resolve({ status: xhr.status, statusText: xhr.statusText, body: xhr.responseText });
    xhr.onerror = () => reject(new ApiClientError(0, 'NETWORK', 'Network error'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    init.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', init.file, init.fileName);
    xhr.send(form);
  });
}

function uploadError(res: { status: number; statusText: string; body: string }): ApiClientError {
  let json: unknown = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  const parsed = ErrorResponse.safeParse(json);
  if (!parsed.success) return new ApiClientError(res.status, 'INTERNAL', res.statusText);
  const e = parsed.data.error;
  return new ApiClientError(res.status, e.code, e.message, e.traceId, e.details);
}

/**
 * A multipart upload of one file (field `file`) with upload progress, e.g. a lodging video. Same
 * headers, one silent refresh-and-retry on 401 and error envelope as `api()`.
 */
export async function apiUpload<T>(path: string, schema: z.ZodType<T>, init: UploadInit): Promise<T> {
  const scope = init.workspaceId ?? workspaceId;
  let res = await sendUpload(path, init, scope);
  if (res.status === 401) {
    if (await refreshSession()) res = await sendUpload(path, init, scope);
    else {
      accessToken = null;
      onSessionExpired();
    }
  }
  if (res.status < 200 || res.status >= 300) {
    const error = uploadError(res);
    if (res.status === 404 && scope && error.details?.['reason'] === 'workspace_access')
      onWorkspaceLost(scope);
    throw error;
  }
  return schema.parse(res.body ? JSON.parse(res.body) : null);
}
```

- [ ] **Step 5: Implement the video hook and the gallery model**

Create `apps/web/src/features/lodging/api/media.ts`:

```ts
import { UploadLodgingVideoResponse } from '@agent-sales/contracts';
import { useCallback } from 'react';

import { ApiClientError, apiUpload } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

/** Uploads one MP4 (`POST /lodging/media/videos`); `onProgress` gets 0..1 while it uploads. */
export function useUploadLodgingVideo() {
  const ws = useWorkspaceId();
  return useCallback(
    (file: File, onProgress: (fraction: number) => void): Promise<UploadLodgingVideoResponse> =>
      apiUpload('/lodging/media/videos', UploadLodgingVideoResponse, {
        file,
        fileName: file.name || 'video.mp4',
        workspaceId: ws,
        onProgress: ({ loaded, total }) => onProgress(total ? loaded / total : 0),
      }),
    [ws],
  );
}

/** i18n key for a failed video upload, chosen by the server's `details.reason`. */
export function videoUploadErrorKey(error: unknown) {
  const reason = error instanceof ApiClientError ? error.details?.['reason'] : undefined;
  if (reason === 'VIDEO_TOO_LARGE' || (error instanceof ApiClientError && error.status === 413))
    return 'lodging.media.videoTooLarge' as const;
  if (reason === 'INVALID_VIDEO') return 'lodging.media.videoInvalid' as const;
  if (reason === 'MEDIA_STORAGE_UNAVAILABLE') return 'lodging.media.storageUnavailable' as const;
  return 'lodging.media.uploadFailed' as const;
}
```

(`useWorkspaceId()` returns `string`, `''` before a session exists.)

Create `apps/web/src/features/lodging/lib/gallery-model.ts`:

```ts
import {
  folderNameKey,
  GALLERY_MAX_FOLDERS,
  GALLERY_MAX_ITEMS,
  galleryCoverUrl,
  type GalleryFolder,
  type GalleryItem,
} from '@agent-sales/contracts';

/** The "Ảnh & video" tab's editable copy: every folder plus the chosen cover, saved together. */
export interface GalleryDraft {
  gallery: GalleryFolder[];
  galleryCover: string;
}

/** Stores one picked image file and resolves to its URL; passed in by the route (commerce upload). */
export type GalleryImageUpload = (file: File) => Promise<string>;

/** An upload failure whose message is already translated for the owner. */
export class GalleryUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GalleryUploadError';
  }
}

export const cloneGallery = (gallery: readonly GalleryFolder[]): GalleryFolder[] =>
  gallery.map((f) => ({ ...f, items: f.items.map((i) => ({ ...i })) }));
export const totalItems = (d: GalleryDraft): number =>
  d.gallery.reduce((n, f) => n + f.items.length, 0);
export const remainingItems = (d: GalleryDraft): number =>
  Math.max(0, GALLERY_MAX_ITEMS - totalItems(d));
export const canAddFolder = (d: GalleryDraft): boolean => d.gallery.length < GALLERY_MAX_FOLDERS;
export const coverOf = (d: GalleryDraft): string | null => galleryCoverUrl(d);

/** True when another folder already has this name (trimmed, case-insensitive, like the API). */
export function nameTaken(d: GalleryDraft, name: string, exceptId?: string): boolean {
  const key = folderNameKey(name);
  return d.gallery.some((f) => f.id !== exceptId && folderNameKey(f.name) === key);
}

/** A chosen cover stays only while it is still an image of some folder (the API checks it). */
function keepCover(d: GalleryDraft): GalleryDraft {
  if (!d.galleryCover) return d;
  const still = d.gallery.some((f) =>
    f.items.some((i) => i.kind === 'image' && i.url === d.galleryCover),
  );
  return still ? d : { ...d, galleryCover: '' };
}

const mapFolder = (
  d: GalleryDraft,
  id: string,
  fn: (f: GalleryFolder) => GalleryFolder,
): GalleryDraft => ({ ...d, gallery: d.gallery.map((f) => (f.id === id ? fn(f) : f)) });

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return next;
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function addFolder(d: GalleryDraft, name: string, id: string = crypto.randomUUID()): GalleryDraft {
  if (!canAddFolder(d) || !name.trim() || nameTaken(d, name)) return d;
  return { ...d, gallery: [...d.gallery, { id, name: name.trim(), items: [] }] };
}

export function renameFolder(d: GalleryDraft, id: string, name: string): GalleryDraft {
  if (!name.trim() || nameTaken(d, name, id)) return d;
  return mapFolder(d, id, (f) => ({ ...f, name: name.trim() }));
}

export function moveFolder(d: GalleryDraft, id: string, delta: -1 | 1): GalleryDraft {
  const from = d.gallery.findIndex((f) => f.id === id);
  return { ...d, gallery: moved(d.gallery, from, from + delta) };
}

export function deleteFolder(d: GalleryDraft, id: string): GalleryDraft {
  return keepCover({ ...d, gallery: d.gallery.filter((f) => f.id !== id) });
}

/** Appends to the end of a folder, cut to what the property may still hold (200 in all). */
export function appendItems(d: GalleryDraft, folderId: string, items: readonly GalleryItem[]): GalleryDraft {
  const room = remainingItems(d);
  if (!room || !items.length) return d;
  return mapFolder(d, folderId, (f) => ({ ...f, items: [...f.items, ...items.slice(0, room)] }));
}

export function reorderItems(d: GalleryDraft, folderId: string, from: number, to: number): GalleryDraft {
  return mapFolder(d, folderId, (f) => ({ ...f, items: moved(f.items, from, to) }));
}

export function moveItem(d: GalleryDraft, folderId: string, index: number, delta: -1 | 1): GalleryDraft {
  return reorderItems(d, folderId, index, index + delta);
}

/** Moves the items at `indexes` to the end of another folder, keeping their order. */
export function moveItemsTo(
  d: GalleryDraft,
  fromId: string,
  indexes: readonly number[],
  toId: string,
): GalleryDraft {
  const source = d.gallery.find((f) => f.id === fromId);
  if (!source || fromId === toId) return d;
  const picked = new Set(indexes);
  const moving = source.items.filter((_, i) => picked.has(i));
  return {
    ...d,
    gallery: d.gallery.map((f) =>
      f.id === fromId
        ? { ...f, items: f.items.filter((_, i) => !picked.has(i)) }
        : f.id === toId
          ? { ...f, items: [...f.items, ...moving] }
          : f,
    ),
  };
}

export function removeItems(d: GalleryDraft, folderId: string, indexes: readonly number[]): GalleryDraft {
  const picked = new Set(indexes);
  return keepCover(mapFolder(d, folderId, (f) => ({ ...f, items: f.items.filter((_, i) => !picked.has(i)) })));
}

export function setCaption(d: GalleryDraft, folderId: string, index: number, caption: string): GalleryDraft {
  return mapFolder(d, folderId, (f) => ({
    ...f,
    items: f.items.map((item, i) => (i === index ? { ...item, caption: caption.slice(0, 300) } : item)),
  }));
}

export function setCover(d: GalleryDraft, url: string): GalleryDraft {
  return { ...d, galleryCover: url };
}

export function folderCounts(f: GalleryFolder): { images: number; videos: number; links: number } {
  return {
    images: f.items.filter((i) => i.kind === 'image').length,
    videos: f.items.filter((i) => i.kind === 'video').length,
    links: f.items.filter((i) => i.kind === 'link').length,
  };
}

export const folderThumb = (f: GalleryFolder): string | null =>
  f.items.find((i) => i.kind === 'image')?.url ?? null;

/** 1-based number of each photo (only photos are sent page by page); null for videos and links. */
export function imageNumbers(items: readonly GalleryItem[]): (number | null)[] {
  let n = 0;
  return items.map((i) => (i.kind === 'image' ? ++n : null));
}

/** Stable sortable ids: the url, with `#k` when the same url appears again. */
export function itemKeys(items: readonly GalleryItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const k = seen.get(i.url) ?? 0;
    seen.set(i.url, k + 1);
    return k ? `${i.url}#${k}` : i.url;
  });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/web exec vitest run src/lib/api-client.test.ts src/features/lodging/lib/gallery-model.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts apps/web/src/features/lodging/api/media.ts apps/web/src/features/lodging/lib
git commit -m "feat(web): upload with progress, lodging video upload hook and gallery model (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Web — the "Ảnh & video" tab (folder list, folder view, tiles, dialogs), route, covers, i18n

**Files:**
- Modify: `packages/i18n/src/messages/vi/common.json` (`lodging.editor.tabs.gallery`, replace `lodging.photos` with `lodging.media`), `packages/i18n/src/messages/en/common.json` (same keys)
- Create: `apps/web/src/features/lodging/hooks/use-media-upload.ts`
- Create: `apps/web/src/features/lodging/components/gallery/text-dialog.tsx`, `link-dialog.tsx`, `move-dialog.tsx`, `media-tile.tsx`, `folder-list.tsx`, `folder-view.tsx`
- Create (tests): `apps/web/src/features/lodging/components/gallery/folder-list.test.tsx`, `folder-view.test.tsx`, `apps/web/src/features/lodging/components/gallery-tab.test.tsx`
- Rewrite: `apps/web/src/features/lodging/components/gallery-tab.tsx`
- Delete: `apps/web/src/features/lodging/components/gallery-editor.tsx`, `gallery-editor.test.tsx`
- Modify: `apps/web/src/features/lodging/components/property-editor.tsx:22-56, 119-128`
- Modify: `apps/web/src/routes/app/properties/$propertyId.tsx` (rewrite)
- Modify: `apps/web/src/features/lodging/components/properties-page.tsx:167-181`, `properties-table.tsx:77-91`, `properties-page.test.tsx:76-98`
- Modify (fixtures): `apps/web/src/testing/lodging-factories.ts:81`, `features/lodging/components/calendar-page.test.tsx:161`, `booking-sheet.test.tsx:309`, `apps/web/e2e/lodging-pages.spec.ts:52`

**Interfaces:**
- Consumes (Task 9): everything in `lib/gallery-model.ts`, `useUploadLodgingVideo`, `videoUploadErrorKey`, `@dnd-kit/*`; (Task 1) `BOT_ALBUM_PAGE_SIZE`, `GALLERY_MAX_FOLDERS`, `GALLERY_MAX_ITEMS`, `LODGING_VIDEO_MAX_BYTES`, `PublicHttpsUrl`, `galleryCoverUrl`.
- Produces:
  - `useMediaUpload({ uploadImage?, remaining, onItems }): { entries: UploadEntry[]; upload: (files: File[]) => Promise<void> }`, `MEDIA_ACCEPT`.
  - `FolderList({ draft, canEdit, onChange, onOpen })`, `FolderView({ draft, folder, canEdit, onChange, onBack, uploadImage? })` where `onChange: (update: (d: GalleryDraft) => GalleryDraft) => void`.
  - `GalleryTab({ property, canEdit, onDirtyChange, uploadImage?, folderId?, onFolderChange })`.
  - `PropertyEditor({ propertyId, uploadImage?, folderId?, onFolderChange? })` (replaces `renderGalleryUpload`).
  - Route `/app/properties/$propertyId` search `{ folder?: string }`.

- [ ] **Step 1: i18n keys**

In `packages/i18n/src/messages/vi/common.json` set `lodging.editor.tabs.gallery` to `"Ảnh & video"` and replace the whole `lodging.photos` object with:

```json
    "media": {
      "hint": "Xếp ảnh và video vào thư mục như trên Google Drive. Bot chọn thư mục theo tên thư mục.",
      "coverTitle": "Ảnh bìa",
      "coverAuto": "Tự động: ảnh đầu tiên của thư mục đầu tiên",
      "coverChosen": "Do bạn chọn",
      "coverReset": "Dùng ảnh bìa tự động",
      "noCover": "Chưa có ảnh bìa",
      "newFolder": "Thư mục mới",
      "folderLimit": "Tối đa {{max}} thư mục",
      "empty": "Chưa có thư mục nào — tạo thư mục đầu tiên, ví dụ \"Ngoài trời ban ngày\".",
      "photos_other": "{{count}} ảnh",
      "videos_other": "{{count}} video",
      "links_other": "{{count}} link",
      "emptyFolder": "Thư mục trống",
      "open": "Mở thư mục {{name}}",
      "folderMenu": "Tuỳ chọn thư mục {{name}}",
      "rename": "Đổi tên",
      "up": "Lên",
      "down": "Xuống",
      "deleteFolder": "Xoá thư mục",
      "deleteFolderTitle": "Xoá thư mục \"{{name}}\"?",
      "deleteFolderBody_other": "{{count}} mục trong thư mục sẽ bị xoá khỏi căn hộ khi bạn lưu.",
      "cancel": "Huỷ",
      "confirmDelete": "Xoá",
      "folderName": "Tên thư mục",
      "createFolder": "Tạo thư mục",
      "renameTitle": "Đổi tên thư mục",
      "apply": "Lưu",
      "nameRequired": "Nhập tên thư mục.",
      "nameTaken": "Đã có thư mục tên này.",
      "back": "Tất cả thư mục",
      "add": "Thêm ảnh/video",
      "addLink": "Thêm link video",
      "help": "Bot gửi trước {{count}} ảnh đầu theo thứ tự này, khách muốn xem thêm thì gửi tiếp. Kéo thả để đổi thứ tự.",
      "remaining_other": "Còn thêm được {{count}} mục",
      "full": "Căn hộ đã đủ {{max}} mục",
      "dropHere": "Kéo thả ảnh hoặc video MP4 vào đây",
      "uploading": "Đang tải {{name}}…",
      "botFirst": "Bot gửi trước",
      "number": "Ảnh {{n}}",
      "videoBadge": "Video",
      "linkBadge": "Link",
      "itemMenu": "Tuỳ chọn cho {{label}}",
      "dragHandle": "Kéo để đổi thứ tự {{label}}",
      "select": "Chọn {{label}}",
      "selected_other": "Đã chọn {{count}}",
      "clearSelection": "Bỏ chọn",
      "moveTo": "Chuyển sang thư mục…",
      "moveTitle": "Chuyển sang thư mục",
      "noOtherFolder": "Chưa có thư mục khác.",
      "setCover": "Đặt làm ảnh bìa",
      "editCaption": "Sửa chú thích",
      "caption": "Chú thích",
      "captionPlaceholder": "Để trống: dùng tên thư mục",
      "remove": "Xoá",
      "linkUrl": "Link (https)",
      "linkUrlInvalid": "Nhập link bắt đầu bằng https://",
      "linkCaption": "Tiêu đề",
      "linkAdd": "Thêm",
      "videoTooLarge": "Video quá 25 MB — hãy thêm dưới dạng link YouTube/Drive.",
      "videoInvalid": "Chỉ nhận video MP4.",
      "storageUnavailable": "Chưa cấu hình kho lưu trữ, chưa tải lên được.",
      "uploadFailed": "Tải lên không thành công, thử lại sau.",
      "skipped_other": "Bỏ qua {{count}} tệp: chỉ nhận ảnh JPEG/PNG/WebP và video MP4, tối đa 200 mục.",
      "dragStart": "Đã nhấc {{label}}",
      "dragOver": "{{label}} đang ở vị trí {{position}}",
      "dragEnd": "Đã thả {{label}} ở vị trí {{position}}",
      "dragCancel": "Đã huỷ kéo {{label}}",
      "save": "Lưu ảnh & video"
    },
```

In `packages/i18n/src/messages/en/common.json` set `lodging.editor.tabs.gallery` to `"Photos & videos"` and replace `lodging.photos` with:

```json
    "media": {
      "hint": "Keep photos and videos in folders, like on Google Drive. The bot picks a folder by its name.",
      "coverTitle": "Cover photo",
      "coverAuto": "Automatic: the first photo of the first folder",
      "coverChosen": "Chosen by you",
      "coverReset": "Use the automatic cover",
      "noCover": "No cover photo yet",
      "newFolder": "New folder",
      "folderLimit": "At most {{max}} folders",
      "empty": "No folders yet — create the first one, for example \"Outdoor by day\".",
      "photos_one": "{{count}} photo",
      "photos_other": "{{count}} photos",
      "videos_one": "{{count}} video",
      "videos_other": "{{count}} videos",
      "links_one": "{{count}} link",
      "links_other": "{{count}} links",
      "emptyFolder": "Empty folder",
      "open": "Open folder {{name}}",
      "folderMenu": "Options for folder {{name}}",
      "rename": "Rename",
      "up": "Move up",
      "down": "Move down",
      "deleteFolder": "Delete folder",
      "deleteFolderTitle": "Delete folder \"{{name}}\"?",
      "deleteFolderBody_one": "{{count}} item in this folder will be removed from the property when you save.",
      "deleteFolderBody_other": "{{count}} items in this folder will be removed from the property when you save.",
      "cancel": "Cancel",
      "confirmDelete": "Delete",
      "folderName": "Folder name",
      "createFolder": "Create folder",
      "renameTitle": "Rename folder",
      "apply": "Save",
      "nameRequired": "Enter a folder name.",
      "nameTaken": "A folder with this name already exists.",
      "back": "All folders",
      "add": "Add photos/videos",
      "addLink": "Add video link",
      "help": "The bot sends the first {{count}} photos in this order and sends more when the customer asks. Drag to reorder.",
      "remaining_one": "{{count}} more item allowed",
      "remaining_other": "{{count}} more items allowed",
      "full": "This property has the maximum of {{max}} items",
      "dropHere": "Drop photos or MP4 videos here",
      "uploading": "Uploading {{name}}…",
      "botFirst": "Sent first",
      "number": "Photo {{n}}",
      "videoBadge": "Video",
      "linkBadge": "Link",
      "itemMenu": "Options for {{label}}",
      "dragHandle": "Drag to reorder {{label}}",
      "select": "Select {{label}}",
      "selected_one": "{{count}} selected",
      "selected_other": "{{count}} selected",
      "clearSelection": "Clear selection",
      "moveTo": "Move to folder…",
      "moveTitle": "Move to folder",
      "noOtherFolder": "There is no other folder.",
      "setCover": "Set as cover",
      "editCaption": "Edit caption",
      "caption": "Caption",
      "captionPlaceholder": "Empty: the folder name is used",
      "remove": "Remove",
      "linkUrl": "Link (https)",
      "linkUrlInvalid": "Enter a link starting with https://",
      "linkCaption": "Title",
      "linkAdd": "Add",
      "videoTooLarge": "The video is over 25 MB — add it as a YouTube/Drive link instead.",
      "videoInvalid": "Only MP4 videos are accepted.",
      "storageUnavailable": "Storage is not configured, so uploads are unavailable.",
      "uploadFailed": "The upload failed, try again later.",
      "skipped_one": "Skipped {{count}} file: only JPEG/PNG/WebP photos and MP4 videos, at most 200 items.",
      "skipped_other": "Skipped {{count}} files: only JPEG/PNG/WebP photos and MP4 videos, at most 200 items.",
      "dragStart": "Picked up {{label}}",
      "dragOver": "{{label}} is at position {{position}}",
      "dragEnd": "Dropped {{label}} at position {{position}}",
      "dragCancel": "Cancelled dragging {{label}}",
      "save": "Save photos & videos"
    },
```

Run: `grep -rn "lodging.photos" apps/web/src` → Expected: only `gallery-editor.tsx` / `gallery-tab.tsx` (both replaced below).

- [ ] **Step 2: Write the failing component tests**

Create `apps/web/src/features/lodging/components/gallery/folder-list.test.tsx`:

```tsx
import type { GalleryFolder } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import type { GalleryDraft } from '../../lib/gallery-model';
import { FolderList } from './folder-list';

beforeAll(() => {
  // Radix menus use pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

const img = (n: number) => ({ kind: 'image' as const, url: `https://cdn.example.com/${n}.jpg`, caption: '' });
const VIDEO = {
  kind: 'video' as const,
  url: '/media/lodging/0192f0a0-0000-7000-8000-000000000001/0192f0a0-0000-7000-8000-0000000000cc.mp4',
  caption: '',
};
const rooms: GalleryFolder = { id: 'rooms', name: 'Phòng ngủ', items: [img(1), img(2), VIDEO] };
const outdoor: GalleryFolder = { id: 'out', name: 'Ngoài trời', items: [] };

function Harness({ initial }: { initial: GalleryDraft }) {
  const [draft, setDraft] = useState(initial);
  const [opened, setOpened] = useState('');
  return (
    <>
      <FolderList draft={draft} canEdit onChange={(fn) => setDraft((d) => fn(d))} onOpen={setOpened} />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
      <output data-testid="opened">{opened}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as GalleryDraft;

describe('FolderList', () => {
  it('shows the empty state and creates folders, refusing a duplicate name', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ gallery: [], galleryCover: '' }} />);
    expect(screen.getByText(/Chưa có thư mục nào/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), 'Phòng ngủ');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    expect(current().gallery.map((f) => f.name)).toEqual(['Phòng ngủ']);
    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), ' phòng NGỦ ');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    expect(within(dialog).getByText('Đã có thư mục tên này.')).toBeInTheDocument();
    expect(current().gallery).toHaveLength(1);
  });

  it('shows counts and the cover, reorders, renames and opens folders', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ gallery: [rooms, outdoor], galleryCover: '' }} />);
    expect(screen.getByText('2 ảnh · 1 video')).toBeInTheDocument();
    expect(screen.getByText('Thư mục trống')).toBeInTheDocument();
    expect(screen.getByText('Tự động: ảnh đầu tiên của thư mục đầu tiên')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Ngoài trời' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Lên' }));
    expect(current().gallery.map((f) => f.id)).toEqual(['out', 'rooms']);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Ngoài trời' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đổi tên' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Tên thư mục');
    expect(input).toHaveValue('Ngoài trời');
    await user.clear(input);
    await user.type(input, 'Sân vườn');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(current().gallery[0]?.name).toBe('Sân vườn');
    await user.click(screen.getByRole('button', { name: 'Mở thư mục Phòng ngủ' }));
    expect(screen.getByTestId('opened')).toHaveTextContent('rooms');
  });

  it('asks before deleting a folder with items and deletes an empty one at once', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ gallery: [rooms, outdoor], galleryCover: '' }} />);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Ngoài trời' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá thư mục' }));
    expect(current().gallery.map((f) => f.id)).toEqual(['rooms']);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Phòng ngủ' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá thư mục' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('Xoá thư mục "Phòng ngủ"?')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Xoá' }));
    expect(current().gallery).toEqual([]);
  });
});
```

Create `apps/web/src/features/lodging/components/gallery/folder-view.test.tsx`:

```tsx
import type { GalleryFolder } from '@agent-sales/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import type { GalleryDraft } from '../../lib/gallery-model';
import { FolderView } from './folder-view';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

const img = (n: number) => ({ kind: 'image' as const, url: `https://cdn.example.com/${n}.jpg`, caption: '' });
const VIDEO = {
  kind: 'video' as const,
  url: '/media/lodging/0192f0a0-0000-7000-8000-000000000001/0192f0a0-0000-7000-8000-0000000000cc.mp4',
  caption: 'Tour',
};
/** Photo 1, a video, then photos 2..10. */
const rooms: GalleryFolder = {
  id: 'rooms',
  name: 'Phòng ngủ',
  items: [img(1), VIDEO, ...Array.from({ length: 9 }, (_, i) => img(i + 2))],
};
const outdoor: GalleryFolder = { id: 'out', name: 'Ngoài trời', items: [] };

function Harness({ initial }: { initial: GalleryDraft }) {
  const [draft, setDraft] = useState(initial);
  const folder = draft.gallery.find((f) => f.id === 'rooms');
  if (!folder) return null;
  return (
    <>
      <FolderView
        draft={draft}
        folder={folder}
        canEdit
        onChange={(fn) => setDraft((d) => fn(d))}
        onBack={() => {}}
        uploadImage={async () => 'https://cdn.example.com/new.jpg'}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as GalleryDraft;
const start = () => render(<Harness initial={{ gallery: [rooms, outdoor], galleryCover: '' }} />);

describe('FolderView', () => {
  it('numbers the photos only and marks the first 8 photos as sent first', () => {
    start();
    expect(screen.getByText(/Bot gửi trước 8 ảnh đầu theo thứ tự này/)).toBeInTheDocument();
    const tiles = screen.getAllByTestId('media-tile');
    expect(tiles).toHaveLength(11);
    expect(within(tiles[0]!).getByText('1')).toBeInTheDocument();
    expect(within(tiles[1]!).getByText('Video')).toBeInTheDocument();
    expect(within(tiles[2]!).getByText('2')).toBeInTheDocument();
    expect(tiles.filter((t) => t.dataset.early === 'true')).toHaveLength(8);
    expect(tiles[1]?.dataset.early).toBeUndefined();
    expect(tiles[9]?.dataset.early).toBeUndefined();
    expect(screen.getAllByText('Bot gửi trước')).toHaveLength(1);
  });

  it('reorders with the menu, moves a photo to another folder and sets the cover', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Lên' }));
    expect(current().gallery[0]?.items.slice(0, 3).map((i) => i.kind)).toEqual(['image', 'image', 'video']);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Chuyển sang thư mục…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ngoài trời' }));
    expect(current().gallery[1]?.items).toEqual([img(1)]);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt làm ảnh bìa' }));
    expect(current().galleryCover).toBe(img(2).url);
  });

  it('removes several selected items at once', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Ảnh 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Tour' }));
    expect(screen.getByText('Đã chọn 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(current().gallery[0]?.items).toHaveLength(9);
  });

  it('adds a video link only when it is https', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'Thêm link video' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Link (https)'), 'http://youtu.be/x');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    expect(within(dialog).getByText('Nhập link bắt đầu bằng https://')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Link (https)'));
    await user.type(within(dialog).getByLabelText('Link (https)'), 'https://youtu.be/x');
    await user.type(within(dialog).getByLabelText('Tiêu đề'), 'Flycam');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    await waitFor(() =>
      expect(current().gallery[0]?.items.at(-1)).toEqual({
        kind: 'link',
        url: 'https://youtu.be/x',
        caption: 'Flycam',
      }),
    );
  });

  it('uploads picked photos into the open folder', async () => {
    start();
    const file = new File(['x'], 'pool.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('media-file-input'), { target: { files: [file] } });
    await waitFor(() =>
      expect(current().gallery[0]?.items.at(-1)).toEqual({
        kind: 'image',
        url: 'https://cdn.example.com/new.jpg',
        caption: '',
      }),
    );
  });

  it('refuses a video over 25 MB before uploading it', async () => {
    start();
    const big = new File(['x'], 'tour.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('media-file-input'), { target: { files: [big] } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Video quá 25 MB — hãy thêm dưới dạng link YouTube/Drive.',
      ),
    );
    expect(current().gallery[0]?.items).toHaveLength(11);
  });
});
```

Create `apps/web/src/features/lodging/components/gallery-tab.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LODGING_IDS, propertyFixture } from '@/testing/lodging-factories';
import { renderWithProviders } from '@/testing/render';

import { GalleryTab } from './gallery-tab';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const path = `/lodging/properties/${LODGING_IDS.a17}`;

describe('GalleryTab', () => {
  it('saves every folder and the chosen cover as one PATCH', async () => {
    const photo = { kind: 'image' as const, url: 'https://cdn.example.com/1.jpg', caption: '' };
    const property = propertyFixture({
      gallery: [{ id: 'rooms', name: 'Phòng ngủ', items: [photo] }],
      galleryCover: '',
    });
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '').split('?')[0]}`;
      if (key !== `PATCH ${path}`) throw new Error(`unexpected request ${key}`);
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(property), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    function Harness() {
      const [folder, setFolder] = useState<string | undefined>();
      return (
        <GalleryTab
          property={property}
          canEdit
          onDirtyChange={() => {}}
          folderId={folder}
          onFolderChange={setFolder}
        />
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), 'Ngoài trời');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    await user.click(screen.getByRole('button', { name: 'Mở thư mục Phòng ngủ' }));
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt làm ảnh bìa' }));
    await user.click(screen.getByRole('button', { name: 'Lưu ảnh & video' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      version: property.version,
      patch: {
        gallery: [
          { id: 'rooms', name: 'Phòng ngủ', items: [photo] },
          { id: expect.any(String), name: 'Ngoài trời', items: [] },
        ],
        galleryCover: photo.url,
      },
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @agent-sales/web exec vitest run src/features/lodging/components/gallery src/features/lodging/components/gallery-tab.test.tsx`
Expected: FAIL — `./folder-list`, `./folder-view` not found; `GalleryTab` has no folder props.

- [ ] **Step 4: Upload hook**

Create `apps/web/src/features/lodging/hooks/use-media-upload.ts`:

```ts
import { type GalleryItem, LODGING_VIDEO_MAX_BYTES } from '@agent-sales/contracts';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useUploadLodgingVideo, videoUploadErrorKey } from '../api/media';
import { type GalleryImageUpload, GalleryUploadError } from '../lib/gallery-model';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** What the "Thêm ảnh/video" picker offers (WebP is converted to JPEG by the image upload). */
export const MEDIA_ACCEPT = [...IMAGE_TYPES, 'video/mp4'].join(',');

export interface UploadEntry {
  id: number;
  name: string;
  kind: 'image' | 'video';
  /** 0..1 for videos (XHR progress); images show a spinner only. */
  progress: number;
}

/**
 * Uploads picked or dropped files one after another: photos through the route's `uploadImage`
 * (commerce's resize + store), MP4 videos through the lodging video route with progress. Every
 * finished file is handed to `onItems` at once, so a later failure keeps the earlier ones.
 */
export function useMediaUpload({
  uploadImage,
  remaining,
  onItems,
}: {
  uploadImage?: GalleryImageUpload | undefined;
  remaining: number;
  onItems: (items: GalleryItem[]) => void;
}) {
  const { t } = useTranslation();
  const uploadVideo = useUploadLodgingVideo();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const seq = useRef(0);

  const upload = useCallback(
    async (files: File[]) => {
      const notMp4 = files.filter((f) => f.type.startsWith('video/') && f.type !== 'video/mp4');
      if (notMp4.length) toast.error(t('lodging.media.videoInvalid'));
      const supported = files.filter((f) => IMAGE_TYPES.includes(f.type) || f.type === 'video/mp4');
      const accepted = supported.slice(0, remaining);
      const skipped = files.length - notMp4.length - accepted.length;
      if (skipped > 0) toast.warning(t('lodging.media.skipped', { count: skipped }));
      for (const file of accepted) {
        const id = ++seq.current;
        const kind = file.type === 'video/mp4' ? 'video' : 'image';
        setEntries((all) => [...all, { id, name: file.name, kind, progress: 0 }]);
        try {
          if (kind === 'video') {
            if (file.size > LODGING_VIDEO_MAX_BYTES)
              throw new GalleryUploadError(t('lodging.media.videoTooLarge'));
            const stored = await uploadVideo(file, (progress) =>
              setEntries((all) => all.map((e) => (e.id === id ? { ...e, progress } : e))),
            );
            onItems([{ kind: 'video', url: stored.url, caption: '' }]);
          } else {
            if (!uploadImage) throw new GalleryUploadError(t('lodging.media.uploadFailed'));
            onItems([{ kind: 'image', url: await uploadImage(file), caption: '' }]);
          }
        } catch (error) {
          toast.error(
            error instanceof GalleryUploadError ? error.message : t(videoUploadErrorKey(error)),
          );
        } finally {
          setEntries((all) => all.filter((e) => e.id !== id));
        }
      }
    },
    [onItems, remaining, t, uploadImage, uploadVideo],
  );

  return { entries, upload };
}
```

- [ ] **Step 5: Dialogs**

Create `apps/web/src/features/lodging/components/gallery/text-dialog.tsx`:

```tsx
import { type FormEvent, useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** One text field in a dialog (folder name, caption); `validate` returns an error text or null. */
export function TextDialog({
  open,
  onOpenChange,
  title,
  label,
  initial,
  maxLength,
  placeholder,
  submitLabel,
  validate,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  placeholder?: string | undefined;
  submitLabel: string;
  validate?: ((value: string) => string | null) | undefined;
  onSubmit: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);
  const submit = (e: FormEvent) => {
    // Portalled out of the tab's <form>, but React still bubbles the submit event to it.
    e.preventDefault();
    e.stopPropagation();
    const problem = validate?.(value) ?? null;
    if (problem) setError(problem);
    else onSubmit(value);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p id={`${id}-error`} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Create `apps/web/src/features/lodging/components/gallery/link-dialog.tsx`:

```tsx
import { type GalleryItem, PublicHttpsUrl } from '@agent-sales/contracts';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** "Thêm link video": an https link (YouTube, Drive, TikTok…) and an optional title. */
export function LinkDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: GalleryItem) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setUrl('');
      setCaption('');
      setTried(false);
    }
  }, [open]);
  const valid = PublicHttpsUrl.safeParse(url).success;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTried(true);
    if (!valid) return;
    onAdd({ kind: 'link', url: url.trim(), caption: caption.trim() });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('lodging.media.addLink')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-url`}>{t('lodging.media.linkUrl')}</Label>
            <Input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              value={url}
              maxLength={2000}
              placeholder="https://youtu.be/…"
              aria-invalid={tried && !valid ? true : undefined}
              aria-describedby={tried && !valid ? `${id}-url-error` : undefined}
              onChange={(e) => setUrl(e.target.value)}
            />
            {tried && !valid && (
              <p id={`${id}-url-error`} className="text-xs text-destructive">
                {t('lodging.media.linkUrlInvalid')}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-caption`}>{t('lodging.media.linkCaption')}</Label>
            <Input
              id={`${id}-caption`}
              value={caption}
              maxLength={300}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit">{t('lodging.media.linkAdd')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Create `apps/web/src/features/lodging/components/gallery/move-dialog.tsx`:

```tsx
import type { GalleryFolder } from '@agent-sales/contracts';
import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** "Chuyển sang thư mục…": pick the folder the selected items move to (appended at its end). */
export function MoveDialog({
  open,
  onOpenChange,
  folders,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: readonly GalleryFolder[];
  onPick: (folderId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('lodging.media.moveTitle')}</DialogTitle>
        </DialogHeader>
        {folders.length ? (
          <ul className="grid gap-1">
            {folders.map((f) => (
              <li key={f.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => onPick(f.id)}
                >
                  <Folder aria-hidden />
                  {f.name}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('lodging.media.noOtherFolder')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Tile, folder view, folder list**

Create `apps/web/src/features/lodging/components/gallery/media-tile.tsx`:

```tsx
import type { GalleryItem } from '@agent-sales/contracts';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Link2, MoreVertical, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { hostOf } from '../../lib/gallery-model';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Preview({ item, label }: { item: GalleryItem; label: string }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  if (item.kind === 'image')
    return (
      <img
        src={item.url}
        alt={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="absolute inset-0 size-full object-cover"
      />
    );
  if (item.kind === 'video')
    return (
      <>
        <video
          src={item.url}
          preload="metadata"
          muted
          playsInline
          aria-label={label}
          className="absolute inset-0 size-full object-cover"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setSeconds(d);
          }}
        />
        <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-background/90 px-1.5 text-xs tabular-nums">
          <Play className="size-3" aria-hidden />
          {seconds !== null ? clock(seconds) : null}
        </span>
      </>
    );
  return (
    <div className="absolute inset-0 grid place-content-center justify-items-center gap-1 p-2 text-center text-xs text-muted-foreground">
      <Link2 className="size-6" aria-hidden />
      <span className="line-clamp-2 break-all">{item.caption || hostOf(item.url)}</span>
      <span className="truncate">{hostOf(item.url)}</span>
    </div>
  );
}

/** One sortable tile of the folder grid: its number (photos), badges, selection and ⋮ menu. */
export function MediaTile({
  id,
  item,
  label,
  number,
  early,
  showEarlyLabel,
  isCover,
  canEdit,
  selected,
  first,
  last,
  canMove,
  onSelect,
  onUp,
  onDown,
  onMove,
  onCover,
  onCaption,
  onRemove,
}: {
  id: string;
  item: GalleryItem;
  label: string;
  number: number | null;
  early: boolean;
  showEarlyLabel: boolean;
  isCover: boolean;
  canEdit: boolean;
  selected: boolean;
  first: boolean;
  last: boolean;
  canMove: boolean;
  onSelect: (selected: boolean) => void;
  onUp: () => void;
  onDown: () => void;
  onMove: () => void;
  onCover: () => void;
  onCaption: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="media-tile"
      data-early={early || undefined}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
        early && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
    >
      <Preview item={item} label={label} />
      <span className="absolute top-1.5 left-1.5 rounded bg-background/90 px-1.5 text-xs font-semibold tabular-nums">
        {number !== null
          ? number
          : item.kind === 'video'
            ? t('lodging.media.videoBadge')
            : t('lodging.media.linkBadge')}
      </span>
      {showEarlyLabel && (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
          {t('lodging.media.botFirst')}
        </span>
      )}
      {isCover && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-background/90 px-1.5 text-[11px]">
          {t('lodging.media.coverTitle')}
        </span>
      )}
      {canEdit && (
        <div className="absolute top-1 right-1 flex items-center gap-0.5">
          <Checkbox
            aria-label={t('lodging.media.select', { label })}
            checked={selected}
            onCheckedChange={(v) => onSelect(v === true)}
            className={cn(
              'bg-background',
              !selected &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100',
            )}
          />
          <button
            type="button"
            aria-label={t('lodging.media.dragHandle', { label })}
            className="grid size-7 cursor-grab touch-none place-items-center rounded bg-background/90"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                aria-label={t('lodging.media.itemMenu', { label })}
              >
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={first} onSelect={onUp}>
                {t('lodging.media.up')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onSelect={onDown}>
                {t('lodging.media.down')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMove} onSelect={onMove}>
                {t('lodging.media.moveTo')}
              </DropdownMenuItem>
              {item.kind === 'image' && !isCover && (
                <DropdownMenuItem onSelect={onCover}>{t('lodging.media.setCover')}</DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onCaption}>{t('lodging.media.editCaption')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                {t('lodging.media.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}
```

Create `apps/web/src/features/lodging/components/gallery/folder-view.tsx`:

```tsx
import {
  BOT_ALBUM_PAGE_SIZE,
  GALLERY_MAX_ITEMS,
  type GalleryFolder,
  type GalleryItem,
} from '@agent-sales/contracts';
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { ChevronLeft, FolderInput, ImagePlus, Link2, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { MEDIA_ACCEPT, useMediaUpload } from '../../hooks/use-media-upload';
import {
  appendItems,
  coverOf,
  type GalleryDraft,
  type GalleryImageUpload,
  hostOf,
  imageNumbers,
  itemKeys,
  moveItem,
  moveItemsTo,
  remainingItems,
  removeItems,
  reorderItems,
  setCaption,
  setCover,
} from '../../lib/gallery-model';
import { LinkDialog } from './link-dialog';
import { MediaTile } from './media-tile';
import { MoveDialog } from './move-dialog';
import { TextDialog } from './text-dialog';

type Translate = ReturnType<typeof useTranslation>['t'];

/** What a tile is called in menus and announcements: "Ảnh 3", a video's caption, a link's host. */
function itemLabel(t: Translate, item: GalleryItem, number: number | null): string {
  if (item.kind === 'image') return t('lodging.media.number', { n: number ?? 0 });
  if (item.kind === 'video') return item.caption || t('lodging.media.videoBadge');
  return item.caption || hostOf(item.url);
}

/** Inside one folder: add photos/videos/links, numbered sortable grid, multi-select (spec §5). */
export function FolderView({
  draft,
  folder,
  canEdit,
  onChange,
  onBack,
  uploadImage,
}: {
  draft: GalleryDraft;
  folder: GalleryFolder;
  canEdit: boolean;
  onChange: (update: (d: GalleryDraft) => GalleryDraft) => void;
  onBack: () => void;
  uploadImage?: GalleryImageUpload | undefined;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [moving, setMoving] = useState<number[] | null>(null);
  const [captioning, setCaptioning] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const remaining = remainingItems(draft);
  const full = remaining <= 0;
  const { entries, upload } = useMediaUpload({
    uploadImage,
    remaining,
    onItems: (items) => onChange((d) => appendItems(d, folder.id, items)),
  });
  const keys = itemKeys(folder.items);
  const numbers = imageNumbers(folder.items);
  const labels = folder.items.map((item, i) => itemLabel(t, item, numbers[i] ?? null));
  const labelOf = (id: string | number) => labels[keys.indexOf(String(id))] ?? '';
  const positionOf = (id: string | number) => keys.indexOf(String(id)) + 1;
  const others = draft.gallery.filter((f) => f.id !== folder.id);
  const cover = coverOf(draft);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('lodging.media.dragStart', { label: labelOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('lodging.media.dragOver', { label: labelOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('lodging.media.dragEnd', { label: labelOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragCancel: ({ active }) => t('lodging.media.dragCancel', { label: labelOf(active.id) }),
  };
  // Positions change after any structural edit, so the selection (by index) is cleared.
  const edit = (fn: (d: GalleryDraft) => GalleryDraft) => {
    setSelected(new Set());
    onChange(fn);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    edit((d) => reorderItems(d, folder.id, from, to));
  };
  const toggle = (i: number, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={onBack}>
          <ChevronLeft aria-hidden />
          {t('lodging.media.back')}
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{folder.name}</h2>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={MEDIA_ACCEPT}
              multiple
              hidden
              aria-label={t('lodging.media.add')}
              data-testid="media-file-input"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void upload(files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus aria-hidden />
              {t('lodging.media.add')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => setLinkOpen(true)}
            >
              <Link2 aria-hidden />
              {t('lodging.media.addLink')}
            </Button>
          </>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {t('lodging.media.help', { count: BOT_ALBUM_PAGE_SIZE })}
      </p>
      {canEdit && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {full
            ? t('lodging.media.full', { max: GALLERY_MAX_ITEMS })
            : t('lodging.media.remaining', { count: remaining })}
        </p>
      )}
      {entries.length > 0 && (
        <ul className="grid gap-1 text-sm" aria-live="polite">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              <span className="min-w-0 truncate">{t('lodging.media.uploading', { name: e.name })}</span>
              {e.kind === 'video' && (
                <progress max={1} value={e.progress} aria-label={e.name} className="h-1.5 w-24" />
              )}
            </li>
          ))}
        </ul>
      )}
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label={t('lodging.media.selected', { count: selected.size })}
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm"
        >
          <span className="font-medium">{t('lodging.media.selected', { count: selected.size })}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!others.length}
            onClick={() => setMoving([...selected].sort((a, b) => a - b))}
          >
            <FolderInput aria-hidden />
            {t('lodging.media.moveTo')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => edit((d) => removeItems(d, folder.id, [...selected]))}
          >
            <Trash2 aria-hidden />
            {t('lodging.media.remove')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('lodging.media.clearSelection')}
          </Button>
        </div>
      )}
      <div
        className={cn('rounded-lg border border-dashed p-2', dragging && 'border-primary bg-accent')}
        onDragOver={(e) => {
          if (!canEdit || full || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          if (canEdit && !full) void upload(Array.from(e.dataTransfer.files));
        }}
      >
        {folder.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('lodging.media.dropHere')}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{ announcements }}
          >
            <SortableContext items={keys} strategy={rectSortingStrategy}>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {folder.items.map((item, i) => {
                  const number = numbers[i] ?? null;
                  return (
                    <MediaTile
                      key={keys[i]}
                      id={keys[i] ?? String(i)}
                      item={item}
                      label={labels[i] ?? ''}
                      number={number}
                      early={number !== null && number <= BOT_ALBUM_PAGE_SIZE}
                      showEarlyLabel={number === 1}
                      isCover={item.kind === 'image' && item.url === cover}
                      canEdit={canEdit}
                      selected={selected.has(i)}
                      first={i === 0}
                      last={i === folder.items.length - 1}
                      canMove={others.length > 0}
                      onSelect={(on) => toggle(i, on)}
                      onUp={() => edit((d) => moveItem(d, folder.id, i, -1))}
                      onDown={() => edit((d) => moveItem(d, folder.id, i, 1))}
                      onMove={() => setMoving([i])}
                      onCover={() => onChange((d) => setCover(d, item.url))}
                      onCaption={() => setCaptioning(i)}
                      onRemove={() => edit((d) => removeItems(d, folder.id, [i]))}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <LinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onAdd={(item) => onChange((d) => appendItems(d, folder.id, [item]))}
      />
      <MoveDialog
        open={moving !== null}
        folders={others}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        onPick={(toId) => {
          const picked = moving ?? [];
          setMoving(null);
          edit((d) => moveItemsTo(d, folder.id, picked, toId));
        }}
      />
      <TextDialog
        open={captioning !== null}
        onOpenChange={(open) => {
          if (!open) setCaptioning(null);
        }}
        title={t('lodging.media.editCaption')}
        label={t('lodging.media.caption')}
        placeholder={t('lodging.media.captionPlaceholder')}
        initial={captioning !== null ? (folder.items[captioning]?.caption ?? '') : ''}
        maxLength={300}
        submitLabel={t('lodging.media.apply')}
        onSubmit={(value) => {
          const index = captioning;
          setCaptioning(null);
          if (index !== null) onChange((d) => setCaption(d, folder.id, index, value.trim()));
        }}
      />
    </div>
  );
}
```

Create `apps/web/src/features/lodging/components/gallery/folder-list.tsx`:

```tsx
import { GALLERY_MAX_FOLDERS, type GalleryFolder } from '@agent-sales/contracts';
import { Film, FolderPlus, ImageOff, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  addFolder,
  canAddFolder,
  coverOf,
  deleteFolder,
  folderCounts,
  folderThumb,
  type GalleryDraft,
  moveFolder,
  nameTaken,
  renameFolder,
  setCover,
} from '../../lib/gallery-model';
import { TextDialog } from './text-dialog';

/** The folder list of the "Ảnh & video" tab, like Drive: cover, folders with counts and ⋮ menus. */
export function FolderList({
  draft,
  canEdit,
  onChange,
  onOpen,
}: {
  draft: GalleryDraft;
  canEdit: boolean;
  onChange: (update: (d: GalleryDraft) => GalleryDraft) => void;
  onOpen: (folderId: string) => void;
}) {
  const { t } = useTranslation();
  // null id = a new folder.
  const [naming, setNaming] = useState<{ id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<GalleryFolder | null>(null);
  const cover = coverOf(draft);
  const renaming = naming?.id ? draft.gallery.find((f) => f.id === naming.id) : undefined;
  const countLabel = (f: GalleryFolder) => {
    const c = folderCounts(f);
    const parts = [
      c.images ? t('lodging.media.photos', { count: c.images }) : '',
      c.videos ? t('lodging.media.videos', { count: c.videos }) : '',
      c.links ? t('lodging.media.links', { count: c.links }) : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('lodging.media.emptyFolder');
  };
  const remove = (f: GalleryFolder) => {
    if (f.items.length) setDeleting(f);
    else onChange((d) => deleteFolder(d, f.id));
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('lodging.media.hint')}</p>
      <section aria-label={t('lodging.media.coverTitle')} className="flex items-center gap-3">
        <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
          {cover ? (
            <img
              src={cover}
              alt={t('lodging.media.coverTitle')}
              referrerPolicy="no-referrer"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <ImageOff className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="grid justify-items-start gap-0.5 text-sm">
          <span className="font-medium">{t('lodging.media.coverTitle')}</span>
          <span className="text-muted-foreground">
            {!cover
              ? t('lodging.media.noCover')
              : draft.galleryCover
                ? t('lodging.media.coverChosen')
                : t('lodging.media.coverAuto')}
          </span>
          {canEdit && draft.galleryCover && (
            <Button type="button" size="xs" variant="ghost" onClick={() => onChange((d) => setCover(d, ''))}>
              {t('lodging.media.coverReset')}
            </Button>
          )}
        </div>
      </section>
      {draft.gallery.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('lodging.media.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {draft.gallery.map((f, i) => {
            const thumb = folderThumb(f);
            return (
              <li key={f.id} className="flex items-center gap-3 p-2">
                <button
                  type="button"
                  aria-label={t('lodging.media.open', { name: f.name })}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => onOpen(f.id)}
                >
                  <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <Film className="size-5 text-muted-foreground" aria-hidden />
                    )}
                  </span>
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{countLabel(f)}</span>
                  </span>
                </button>
                {canEdit && (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('lodging.media.folderMenu', { name: f.name })}
                      >
                        <MoreVertical aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setNaming({ id: f.id })}>
                        {t('lodging.media.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === 0}
                        onSelect={() => onChange((d) => moveFolder(d, f.id, -1))}
                      >
                        {t('lodging.media.up')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === draft.gallery.length - 1}
                        onSelect={() => onChange((d) => moveFolder(d, f.id, 1))}
                      >
                        {t('lodging.media.down')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => remove(f)}>
                        {t('lodging.media.deleteFolder')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canAddFolder(draft)}
            onClick={() => setNaming({ id: null })}
          >
            <FolderPlus aria-hidden />
            {t('lodging.media.newFolder')}
          </Button>
          {!canAddFolder(draft) && (
            <span className="text-xs text-muted-foreground">
              {t('lodging.media.folderLimit', { max: GALLERY_MAX_FOLDERS })}
            </span>
          )}
        </div>
      )}
      <TextDialog
        open={naming !== null}
        onOpenChange={(open) => {
          if (!open) setNaming(null);
        }}
        title={renaming ? t('lodging.media.renameTitle') : t('lodging.media.newFolder')}
        label={t('lodging.media.folderName')}
        initial={renaming?.name ?? ''}
        maxLength={100}
        submitLabel={renaming ? t('lodging.media.apply') : t('lodging.media.createFolder')}
        validate={(value) =>
          !value.trim()
            ? t('lodging.media.nameRequired')
            : nameTaken(draft, value, renaming?.id)
              ? t('lodging.media.nameTaken')
              : null
        }
        onSubmit={(value) => {
          const id = renaming?.id;
          setNaming(null);
          onChange((d) => (id ? renameFolder(d, id, value) : addFolder(d, value)));
        }}
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('lodging.media.deleteFolderTitle', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('lodging.media.deleteFolderBody', { count: deleting?.items.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lodging.media.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleting?.id;
                setDeleting(null);
                if (id) onChange((d) => deleteFolder(d, id));
              }}
            >
              {t('lodging.media.confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

(`DropdownMenuItem` in `components/ui/dropdown-menu.tsx` accepts `variant?: 'default' | 'destructive'` (line 57); `modal={false}` on the menus keeps Radix from leaving `pointer-events: none` on the body when a menu item opens a dialog.)

- [ ] **Step 7: The tab, the editor and the route**

Replace `apps/web/src/features/lodging/components/gallery-tab.tsx` with:

```tsx
import type { PropertyDto } from '@agent-sales/contracts';
import { type FormEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useUpdateProperty } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { cloneGallery, type GalleryDraft, type GalleryImageUpload } from '../lib/gallery-model';
import { FolderList } from './gallery/folder-list';
import { FolderView } from './gallery/folder-view';
import { TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

const draftOf = (p: PropertyDto): GalleryDraft => ({
  gallery: cloneGallery(p.gallery),
  galleryCover: p.galleryCover,
});

/**
 * "Ảnh & video" tab (T-192): the folder list, or the open folder (`folderId`, kept in the URL by
 * the route so Back works). One draft of every folder plus the cover, saved with one PATCH.
 */
export function GalleryTab({
  property: p,
  canEdit,
  onDirtyChange,
  uploadImage,
  folderId,
  onFolderChange,
}: {
  property: PropertyDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
  uploadImage?: GalleryImageUpload | undefined;
  folderId?: string | undefined;
  onFolderChange: (folderId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const base = useMemo(() => draftOf(p), [p]);
  const { draft, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const update = useUpdateProperty();
  const saveError = useSaveError();
  const change = (fn: (d: GalleryDraft) => GalleryDraft) => setDraft((d) => fn(d));
  const open = folderId ? draft.gallery.find((f) => f.id === folderId) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (update.isPending || !canEdit) return;
    update.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          patch: { gallery: draft.gallery, galleryCover: draft.galleryCover },
        },
      },
      {
        onSuccess: (saved) => {
          setDraft(draftOf(saved));
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
        },
        onError: (error) => saveError(error, { onStale: discard }),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {open ? (
        <FolderView
          draft={draft}
          folder={open}
          canEdit={canEdit}
          onChange={change}
          onBack={() => onFolderChange(undefined)}
          uploadImage={uploadImage}
        />
      ) : (
        <FolderList draft={draft} canEdit={canEdit} onChange={change} onOpen={onFolderChange} />
      )}
      <TabSaveBar
        dirty={dirty}
        pending={update.isPending}
        canEdit={canEdit}
        label={t('lodging.media.save')}
      />
    </form>
  );
}
```

Delete `apps/web/src/features/lodging/components/gallery-editor.tsx` and `gallery-editor.test.tsx` (`git rm`).

In `apps/web/src/features/lodging/components/property-editor.tsx`:
- Replace line 23 (`import type { GalleryUploadSlot } from './gallery-editor';`) with `import type { GalleryImageUpload } from '../lib/gallery-model';`.
- Replace the props (lines 37–43) with:

```tsx
export function PropertyEditor({
  propertyId,
  uploadImage,
  folderId,
  onFolderChange,
}: {
  propertyId: string;
  uploadImage?: GalleryImageUpload | undefined;
  /** The open gallery folder (route search `folder`); opens the "Ảnh & video" tab. */
  folderId?: string | undefined;
  onFolderChange?: ((folderId: string | undefined) => void) | undefined;
}) {
```

- Replace `useState<TabKey>('info')` with `useState<TabKey>(folderId ? 'gallery' : 'info')`.
- Replace `shouldBlockFn: () => dirty,` with:

```tsx
    // Opening or closing a gallery folder only changes the search: that is not leaving the page.
    shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname,
```

- Replace the `GalleryTab` element (lines 122–128) with:

```tsx
            {key === 'gallery' && (
              <GalleryTab
                {...shared}
                onDirtyChange={reporters.gallery}
                uploadImage={uploadImage}
                folderId={folderId}
                onFolderChange={onFolderChange ?? (() => {})}
              />
            )}
```

Replace `apps/web/src/routes/app/properties/$propertyId.tsx` with:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { imageUploadErrorKey, useUploadProductImage } from '@/features/commerce/api/commerce';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertyEditor } from '@/features/lodging/components/property-editor';
import { GalleryUploadError } from '@/features/lodging/lib/gallery-model';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { ImageUnreadableError, resizeImage } from '@/lib/resize-image';

/** `folder`: the open folder of the "Ảnh & video" tab, so Back returns to the folder list. */
const Search = z.object({ folder: z.string().max(40).optional().catch(undefined) });

export const Route = createFileRoute('/app/properties/$propertyId')({
  validateSearch: Search,
  component: function PropertyRoute() {
    const { t } = useTranslation();
    const workspace = useCurrentWorkspace();
    const { propertyId } = Route.useParams();
    const { folder } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const { mutateAsync } = useUploadProductImage();
    // Photo upload is owned by commerce (resize to JPEG + shared product image storage).
    const uploadImage = useCallback(
      async (file: File) => {
        try {
          return await mutateAsync(await resizeImage(file));
        } catch (error) {
          throw new GalleryUploadError(
            error instanceof ImageUnreadableError
              ? t('products.form.imageUnreadable')
              : t(imageUploadErrorKey(error)),
          );
        }
      },
      [mutateAsync, t],
    );
    const onFolderChange = useCallback(
      (id: string | undefined) => void navigate({ search: id ? { folder: id } : {} }),
      [navigate],
    );
    return (
      <HotelOnly workspace={workspace}>
        <PropertyEditor
          key={propertyId}
          propertyId={propertyId}
          uploadImage={uploadImage}
          folderId={folder}
          onFolderChange={onFolderChange}
        />
      </HotelOnly>
    );
  },
});
```

`apps/web/src/routeTree.gen.ts` is committed and regenerated by the router plugin; Step 9 builds the app, and the commit in Step 10 includes the file when the build changed it.

- [ ] **Step 8: Covers in the lists and fixtures**

In `apps/web/src/features/lodging/components/properties-page.tsx` add `galleryCoverUrl` to the `@agent-sales/contracts` import (or add `import { galleryCoverUrl } from '@agent-sales/contracts';`), replace `const cover = p.gallery[0];` (line 167) with `const cover = galleryCoverUrl(p);` and `<CoverImage src={cover.url} alt={cover.caption} />` with `<CoverImage src={cover} alt={p.name} />`.

In `apps/web/src/features/lodging/components/properties-table.tsx` do the same: `const cover = galleryCoverUrl(p);` (line 77), `src={cover}`, `alt={p.name}`.

In `apps/web/src/features/lodging/components/properties-page.test.tsx` replace the `tall` fixture's `gallery` (lines 81–86) with:

```tsx
      gallery: [
        {
          id: 'front',
          name: 'Mặt tiền',
          items: [
            {
              kind: 'image',
              url: '/media/products/0192f0a0-0000-7000-8000-000000000001/0192f0a0-0000-7000-8000-0000000000aa.jpg',
              caption: 'Ảnh dọc',
            },
          ],
        },
      ],
```

and replace `screen.findByRole('img', { name: 'Ảnh dọc' })` with `screen.findByRole('img', { name: tall.name })`.

Add `galleryCover: '',` after `gallery: [],` in `apps/web/src/testing/lodging-factories.ts:81`, `apps/web/src/features/lodging/components/calendar-page.test.tsx:161`, `apps/web/src/features/lodging/components/booking-sheet.test.tsx:309` and `apps/web/e2e/lodging-pages.spec.ts:52`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @agent-sales/web exec vitest run src/features/lodging src/lib src/features/ai && pnpm --filter @agent-sales/web typecheck && pnpm --filter @agent-sales/web lint && pnpm --filter @agent-sales/web build`
Expected: PASS, no type or lint errors, bundle budget kept (the property route is a lazy chunk, so `@dnd-kit` stays out of the initial bundle).

- [ ] **Step 10: Commit**

```bash
git add packages/i18n apps/web
git commit -m "feat(web): lodging photo and video folders with numbered sortable tiles (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs and ADR-026

**Files:**
- Create: `docs/adr/ADR-026-lodging-media-folders.md`
- Modify: `docs/adr/README.md` (one row), the ADR-015 file in `docs/adr/` (one consequence line)
- Modify: `docs/lodging.md:22, 54-69, 75`, `docs/06-ai-engine.md:28, 68, 97, 113`, `docs/05-data-model.md:346`, `docs/meta-inbox.md:17, 25`, `docs/02-functional-requirements.md:45`, `docs/10-operations-and-deployment.md:22`, `apps/backend/evals/README.md:4, 21`
- Modify: `apps/backend/src/modules/lodging/MODULE.md`, `apps/backend/src/modules/ai/MODULE.md:33`, `apps/backend/src/modules/conversation/MODULE.md`, `apps/backend/src/modules/commerce/MODULE.md`

**Interfaces:** none (documentation of Tasks 1–10).

- [ ] **Step 1: Write ADR-026**

Create `docs/adr/ADR-026-lodging-media-folders.md`:

```markdown
# ADR-026: Lodging media folders and paged bot albums

- Status: Proposed
- Date: 2026-11-05
- Decision makers: thienlng (owner approval of the design in chat, 2026-11-05)

## Context

A lodging property had one flat list of at most 30 captioned photos, and the bot picked photos one
by one from their captions (at most 3 per `send_message`, ADR-015). Owners keep their sales material
like a Google Drive: folders such as "Ngoài trời ban ngày" or "Bếp – phòng ngủ – karaoke" and a
2–5 minute presentation video. Captioning every photo is busy work, and videos could not be stored.
Spec: `docs/superpowers/specs/2026-11-05-lodging-media-folders-design.md` (T-192).

## Decision

1. **Folders in the existing column.** `lodging_properties.gallery` holds
   `[{id, name, items: [{kind: image|video|link, url, caption}]}]` (≤ 20 folders, ≤ 200 items per
   property, unique names); `gallery_cover` ('' = automatic) is new. Migration 0066 turns a flat list
   into one "Ảnh chung" folder and is safe to run again; the row reader also accepts the flat shape.
2. **A lodging-owned video upload path.** `POST /lodging/media/videos` (multipart, one `file` part,
   ≤ 25 MiB, ISO-BMFF `ftyp` brand check) stores `lodging/<ws>/<uuidv7>.mp4` through the module's own
   `S3PublicObjectStorage` with a 120 s put timeout; `MEDIA_PATH` accepts that key family. Longer
   videos are https links sent as text. Photos keep going through `POST /products/images`.
3. **Paged albums.** The bot product carries `accommodation.albums`. The model sees album ids
   (`a:<product>:<folder>`) and video ids (`v:<product>:<folder>:<item>`); `send_message` gains
   `albumId` (the next 8 photos of the folder the conversation has not received in the last 30
   days, then from the start again; the result reports `remaining`) and `videoId` (one per call; an
   upload is its own video message, a link is appended to the text). `albumId` and `imageIds` are
   exclusive. The conversation module passes the bot's sent attachment URLs in
   `ReplyOptions.sentMediaUrls` (ai never reads conversation tables).
4. **Album cap 3 → 8.** One album message carries up to 8 pictures (Meta accepts 10); this deviates
   from ADR-015 §2, which kept 3 picture ids per `send_message`. `imageIds` stays at 3.
5. **Prompt.** Hotel bots use `sales-agent@20` (= @18 with the folder rules); older versions stay.

## Options considered

1. **A separate `lodging_media` table** (one row per item): proper ordering columns and per-item
   ownership, but a second write path, joins on every bot read and a bigger migration for at most
   200 small items that are always read and written together. Rejected.
2. **Let the model pick photos by caption, more of them** (raise `imageIds` to 8): needs captions on
   every photo (the owner's complaint) and cannot page through a folder. Rejected.
3. **Store videos through the commerce image route** (one upload path): commerce would own lodging
   media and its 1 MiB base64 JSON body cannot carry 25 MB. Rejected.
4. **Import Google Drive folders**: OAuth scope and sync burden for a v1 the owner can do by drag and
   drop. Deferred (spec §10).

## Consequences

- Positive: owners upload as they already organise; the bot sends coherent pages in the owner's
  order and offers more; videos reach Messenger natively.
- Negative: a 25 MB video is buffered in the api process while it uploads (one request at a time per
  owner in practice); deleting an item never deletes its object (no orphan cleanup yet); the website
  widget still shows only the first image of a message.
- Follow-ups: orphan cleanup for product pictures and lodging videos; server-side thumbnails or
  transcoding; album and video rendering in the website widget.
```

Add to `docs/adr/README.md` after the ADR-025 row:

```markdown
| [026](ADR-026-lodging-media-folders.md) | Lodging media folders: photos, uploaded MP4 videos (own upload route, 25 MB) and video links in folders stored in `lodging_properties.gallery`; `send_message` `albumId` sends the next 8 unsent photos of a folder, `videoId` one video; album cap 3 → 8 (deviates from ADR-015) | Proposed |
```

In the ADR-015 file (`ls docs/adr/ADR-015-*`), add at the end of its Consequences section: `- Amended by [ADR-026](ADR-026-lodging-media-folders.md): one album message may carry 8 pictures (\`albumId\`); \`imageIds\` stays at 3.`

- [ ] **Step 2: Update the design docs**

- `docs/lodging.md`:
  - Line 22: replace `and a captioned gallery (uploaded photos or https links, up to 30) are optional` with `and the photos and videos (tab **Ảnh & video**, see "Photos and videos" below) are optional`.
  - Add a table row after the `PATCH /lodging/properties/{id}` row: `| POST \`/lodging/media/videos\` | \`catalog.manage\` | Upload one MP4 (multipart field \`file\`, ≤ 25 MB, ftyp-checked) → \`{url: '/media/lodging/<ws>/<id>.mp4', bytes}\`; 413 \`VIDEO_TOO_LARGE\`, 400 \`INVALID_VIDEO\`, 503 \`MEDIA_STORAGE_UNAVAILABLE\` |`.
  - In "Pictures." (line 69) replace `field: 'gallery[i].url'` with `field: 'gallery[f].items[i].url'`, add `lodging/<ws>/<id>.mp4` to the list of Rapiz key shapes, and add the sentence: `An uploaded video must be this business's (\`/media/lodging/<workspaceId>/…\`), else 400 \`VIDEO_NOT_UPLOADED\`; links are never Rapiz media.`
  - Add a new paragraph after "Pictures.":

```markdown
**Photos and videos (T-192, [ADR-026](adr/ADR-026-lodging-media-folders.md)).** The **Ảnh & video** tab keeps a property's media in folders, like Google Drive: up to 20 folders (unique names, case-insensitive), 200 items in all, each a photo (uploaded through `POST /products/images`, JPEG/PNG), an MP4 video uploaded through `POST /lodging/media/videos` (≤ 25 MB) or an https video link (YouTube, Drive, TikTok…) with an optional title. Captions are optional: the folder name describes a photo without one. Inside a folder every photo is numbered; photos 1–8 are marked "Bot gửi trước" because the bot sends a folder 8 photos at a time in this order and offers the rest. Tiles reorder by drag and drop (keyboard too) or the ⋮ menu (Lên / Xuống / Chuyển sang thư mục… / Đặt làm ảnh bìa / Sửa chú thích / Xoá), and several can be selected to move or remove. The cover (`galleryCover`) is the chosen photo, or the first photo of the first folder that has one (contracts `galleryCoverUrl`; the lists and the bot use it). The open folder is in the URL (`?folder=<id>`). Saving sends the whole `gallery` and `galleryCover` in one `PATCH`. Removing an item never deletes the stored file. Migration 0066 put every existing flat gallery into one folder "Ảnh chung".
```

  - Line 75: replace `the policies, amenities, layout and captioned gallery` with `the policies, amenities, layout, its media folders (\`accommodation.albums\`, with album and video ids for \`send_message\`) and their photos flattened (\`gallery\`)`.
- `docs/06-ai-engine.md`: line 28 → `| **Media albums** | Lodging folders by album id | \`send_message\` \`albumId\` sends the next 8 unsent photos of a folder; \`videoId\` one video or video link (ADR-026) |`; line 68 → `| \`send_message\` \`albumId\` / \`videoId\` | Send a lodging folder page or a video | 8 photos per album message, one video per call |`; in line 97 add after `pictures go out through \`send_message\` by id.`: ` Lodging products also list \`albums\` (\`a:<product>:<folder>\`) and \`videos\` (\`v:<product>:<folder>:<item>\`); the server pages an album over the attachment URLs the conversation already received (\`ReplyOptions.sentMediaUrls\`, last 30 days; the playground sends \`sentMediaUrls\` itself).`; in line 113 replace `(\`:s<n>:img\` for its pictures)` with `(\`:s<n>:img\` for its pictures, at most 8 per album, \`:s<n>:vid\` for a video message)`.
- `docs/05-data-model.md:346`: replace `\`gallery\` (\`{url, caption}[]\`, at most 30)` with `\`gallery\` (media folders \`{id, name, items: [{kind: image|video|link, url, caption}]}[]\`, ≤ 20 folders, ≤ 200 items; migration 0066 turned flat lists into one "Ảnh chung" folder), \`gallery_cover\` (0066, '' = automatic)`.
- `docs/meta-inbox.md`: in line 17 add after `its pictures as one album (\`bot:<event id>:s<n>:img\`…)`: `, then a video as its own message (\`bot:<event id>:s<n>:vid\`, Meta \`attachment.type = video\` by URL, at most 25 MB; a rejected video is logged and recorded as failed, the text stays sent)`; in line 25 replace `max 3, https URLs` with `max 8 per album message (T-192; was 3), https URLs` and `\`ConversationFacade.commitBotImages\`` with `\`ConversationFacade.commitBotAttachments\` (typed \`image | video\`)`; add at the end of line 13's history sentence: ` Bot and staff attachments appear in the history in their own words ("[Bot đã gửi 8 ảnh]", "[Bot đã gửi 1 video]"), never as something the customer sent.`
- `docs/02-functional-requirements.md:45` (BOT-10): set the acceptance column to `Lodging: photos, MP4 videos (≤ 25 MB) and video links in folders; the bot sends a folder 8 photos at a time and offers the rest (T-192); retail image library unchanged`.
- `docs/10-operations-and-deployment.md:22`: add after the Production sentence: `Lodging videos (\`/media/lodging/<ws>/<id>.mp4\`, up to 25 MB) use the same \`/media/*\` route: the proxy must pass \`Range\` requests to the bucket (Caddy and SeaweedFS do), and the public reverse proxy must accept request bodies of at least 26 MB for \`POST /api/v1/lodging/media/videos\` (the beta gate sets \`client_max_body_size 50m\`).`
- `apps/backend/evals/README.md`: in lines 4 and 21 change hotel `@18` to `@20`; add a bullet: `- **Albums (T-192).** A case's \`sent_media\` lists attachment URLs the bot sent before the turn; they reach the pipeline as \`sentMediaUrls\`, so an \`albumId\` send skips them (\`hotel-a17-album-next-page\`). Album ids are \`a:eval-product-<n>:<folder index>\`.`

- [ ] **Step 3: Update the module docs**

- `apps/backend/src/modules/lodging/MODULE.md`: in **HTTP** add `- \`POST /lodging/media/videos\` (\`catalog.manage\`): MP4 upload (\`LodgingMediaService\`, \`interface/http/lodging-media.controller.ts\`, own \`S3PublicObjectStorage\` as \`LODGING_MEDIA_STORAGE\`, 120 s put timeout, key \`lodging/<ws>/<uuidv7>.mp4\`).`; in **Owned tables** add `0066` to the migration list; in the `LODGING_CATALOG_FACADE` bullet replace `captioned gallery` with `media folders as \`albums\` (photos, videos, links) and their photos flattened as \`gallery\` (caption or folder name), \`imageUrls\` cover first`; add an invariant: `- Gallery (T-192): ≤ 20 folders, ≤ 200 items, unique names; Rapiz photos must be \`/media/products/<ws>/…\`, videos \`/media/lodging/<ws>/…\` (\`IMAGE_NOT_UPLOADED\` / \`VIDEO_NOT_UPLOADED\`); \`galleryCover\` is '' or an image of the gallery; a flat pre-0066 list reads as one "Ảnh chung" folder (\`toGallery\`).`
- `apps/backend/src/modules/ai/MODULE.md:33`: change the hotel prompt to `` `@20` (hotel = @18 + the media-folder rules: albums by `albumId`, offer the rest from `remaining`, videos only on request; T-192) `` and `13 … 19` to `13 … 20`; add a line under the tools: `- \`send_message\` \`albumId\` (next 8 unsent photos of a lodging folder; \`ReplyOptions.sentMediaUrls\` / \`PlaygroundRequest.sentMediaUrls\`) and \`videoId\` (one video message or a link in the text); \`imageIds\` ≤ 3 and \`albumId\` are exclusive (ADR-026).`
- `apps/backend/src/modules/conversation/MODULE.md`: on line 9 replace `commitBotImages` with `commitBotAttachments` (typed `image | video`, a video alone); on line 26 replace ``:s<n>:img` album with the single-picture fallback`` with ``:s<n>:img` album of up to 8 pictures (`MAX_BOT_IMAGES`) with the single-picture fallback, `:s<n>:vid` video message`` and add at the end of that bullet: `The processor passes \`sentMediaUrls\` (bot attachments of the last 30 days, \`sentBotMediaUrls\`) to the ai reply; bot and staff attachments appear in the history as "[Bot đã gửi N ảnh]" (\`outboundAttachmentNote\`).`
- `apps/backend/src/modules/commerce/MODULE.md`: after the paragraph "**Only uploaded pictures are accepted.**" (line 66) add: `\`AccommodationDetails.albums\` (optional, T-192) is filled only by the lodging bot product (media folders); commerce accommodation rows keep the flat \`gallery\` and never carry albums.`

- [ ] **Step 4: Check the docs build nothing broken**

Run: `pnpm lint && pnpm arch`
Expected: PASS (docs are not linted, but the step catches stray code edits).

- [ ] **Step 5: Commit**

```bash
git add docs apps/backend/evals/README.md apps/backend/src/modules/*/MODULE.md
git commit -m "docs: lodging media folders, paged bot albums and ADR-026 (T-192)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification

**Files:** none new (fixes only, if a check fails).

**Interfaces:** none.

- [ ] **Step 1: Full gate**

Run: `pnpm check`
Expected: lint, arch, typecheck, test and build all PASS (web bundle budget included).

- [ ] **Step 2: Integration tests touched by this feature (Docker)**

Run: `pnpm --filter @agent-sales/db exec vitest run --config vitest.integration.config.ts src/lodging-media-folders.integration.test.ts && pnpm --filter @agent-sales/backend exec vitest run --config vitest.integration.config.ts test/lodging-properties.integration.spec.ts test/lodging-v2.integration.spec.ts test/lodging-migration.integration.spec.ts test/lodging-bot-holds.integration.spec.ts`
Expected: PASS.

- [ ] **Step 3: Fake-mode evals**

Run: `pnpm --filter @agent-sales/backend eval --group lodging-a17`
Expected: every case passes, including `hotel-a17-album-first-page` and `hotel-a17-album-next-page`, on `sales-agent@20`.

- [ ] **Step 4: Browser verification on the dev stack**

Apply migration 0066 to the dev database (`pnpm --filter @agent-sales/db db:migrate`), restart the dev api and web servers from this checkout (logs in `.dev-logs/`), sign in as a hotel business and check, on a property:
1. Tab label "Ảnh & video"; an existing gallery shows as one folder "Ảnh chung" with every photo in order.
2. Create "Phòng ngủ", open it (URL gets `?folder=`), browser Back returns to the list without the unsaved-changes dialog.
3. Drop 10 JPEG/PNG photos on the grid: per-file progress, tiles numbered 1–10, 1–8 ringed, "Bot gửi trước" on tile 1; reorder by drag, by keyboard (focus the grip, Space, arrows, Space) and by the ⋮ menu.
4. Upload a small MP4 (progress bar, ▶ badge with duration) and a > 25 MB MP4 (toast "Video quá 25 MB — hãy thêm dưới dạng link YouTube/Drive."); add an `http://` link (inline error) and an `https://youtu.be/…` link.
5. Set a cover, save, reload: folders, order and cover persist; the Căn hộ cards and table show the cover.
6. In the bot playground: "cho xem phòng ngủ" sends 8 photos of that folder and offers the rest; "xem thêm" sends the remaining ones; "có video không" plays the uploaded video.
Do not send test messages to real customer Pages (Messenger delivery is covered by unit tests).

- [ ] **Step 5: Hand-off**

Report the commands run and their results, the browser checks done, and anything not verified (live evals without a reachable LLM, Messenger video delivery on a test Page). Do not open the PR from this plan; the `open-pr` skill does that once the owner wants it.
