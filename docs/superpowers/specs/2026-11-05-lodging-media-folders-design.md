# Lodging media folders (photos, videos, links) — design

Task: T-192. Status: approved by the owner in chat on 2026-11-05.

## 1. Problem

A lodging property's "Ảnh" tab is one flat list of at most 30 photos, each with a
required caption. The bot picks photos one by one from those captions.

Owners keep their sales material the way they keep it in Google Drive. They use folders
such as "Ảnh ngoài trời ban ngày", "Ảnh ngoài trời ban đêm" and "Bếp – phòng ngủ –
karaoke", plus a 2–5 minute presentation video. Writing a caption for every photo is busy
work, and video cannot be stored at all.

## 2. Decisions (owner, 2026-11-05)

| # | Decision |
|---|----------|
| D1 | One level of **folders** per property. A folder holds images, uploaded videos and video links. No nested folders. |
| D2 | **Video = option C.** Upload MP4 up to 25 MB, which the bot sends inside the chat. Longer videos are added as an https link (YouTube/Drive/TikTok…), which the bot sends as text. |
| D3 | **Bot sends a folder in pages of 8**, in the order the owner set, then offers the rest ("Còn N ảnh nữa…"). It does not send the whole folder at once, and it does not pick photos by AI. |
| D4 | The order is **numbered on every tile**. Tiles 1–8 are marked "Bot gửi trước". A sentence at the top explains the rule. |
| D5 | Folders are **not linked to rooms**. The folder name ("Phòng 102") is what the bot matches. |
| D6 | Upload is manual: drag/drop or pick files, and paste a video link by hand. There is **no Google Drive folder import**. |
| D7 | Captions become **optional**. The folder name is the default description. |

## 3. Data model

### 3.1 Contracts (`packages/contracts/src/lodging/lodging.schema.ts`)

```ts
GalleryItem = discriminatedUnion('kind', [
  { kind: 'image', url: PublicImageUrl,        caption: string ≤300 (default '') },
  { kind: 'video', url: LodgingVideoPath,      caption: string ≤300 (default '') },
  { kind: 'link',  url: HttpsUrl (≤2000),      caption: string ≤300 (default '') },
])
GalleryFolder = { id: string (1–40, [A-Za-z0-9_-]), name: string trim 1–100, items: GalleryItem[] ≤200 }
property.gallery      : GalleryFolder[] ≤20, total items ≤200, unique folder ids, unique trimmed names (case-insensitive)
property.galleryCover : string ('' = automatic) — must equal the url of an image item when not ''
```

- `LodgingVideoPath` is a Rapiz `/media/lodging/<ws>/<id>.mp4` path. Arbitrary video URLs
  are not accepted as `video`; those go in as `link`.
- `HttpsUrl` is `https:` only (no `http:`, `javascript:` or `data:`), with the same guard
  as `PublicImageUrl`.
- The cover is `galleryCover` when it is set. Otherwise it is the first image of the first
  folder that has one. A helper `galleryCoverUrl(p)` in contracts is used by the web (list,
  cards) and the bot product.
- PATCH semantics stay as they are: a given `gallery` replaces the stored one. The owner
  assistant keeps `use: 'write'` on PATCH.

### 3.2 DB (`0066_lodging_media_folders.sql`)

- `lodging_properties.gallery` keeps its column. The JSON shape changes to folders.
- New column `gallery_cover text not null default ''`.
- Back-fill: a row whose `gallery` is a non-empty array of `{url, caption}` objects becomes
  `[{id: <generated>, name: 'Ảnh chung', items: [{kind:'image', url, caption}, …]}]` in the
  same order (`jsonb_array_elements … with ordinality`, as 0041 does). An empty array stays
  `[]`. A row that already has folders (an element with an `items` key) is left untouched,
  so the migration can run again safely.
- `MEDIA_PATH` (`packages/contracts/src/common/media.ts`) and `isMediaPath` gain the key
  family `lodging/<ws uuid>/<uuid>.mp4`.

## 4. Upload

- **Images**: unchanged path. The route composes commerce's `ImageUploadZone`
  (resize → JPEG, `POST /products/images`, `products/<ws>/…`). It now uploads several files
  in one drop and appends them to the open folder. `assertOwnGallery` checks image items as
  it does today.
- **Videos**: new `POST /lodging/media/videos` in `lodging/interface/http`. It is declared
  in `lodging.routes.ts` with `assistant: { use: 'never' }`.
  - Multipart, a single `file` part, `req.file({ limits: { fileSize: 25 MiB } })`.
    A file that is too big returns 413 `VIDEO_TOO_LARGE`.
  - MIME `video/mp4`, verified by the ISO-BMFF `ftyp` box in the first bytes
    (brand `isom|iso2|mp41|mp42|avc1|M4V |dash`). Anything else returns 400 `INVALID_VIDEO`.
  - Stored with `PublicObjectStorage.put` under `lodging/<ws>/<uuidv7>.mp4`, content type
    `video/mp4`. Lodging gets its own `S3PublicObjectStorage` provider, as commerce and
    knowledge have. The put timeout for this provider is 120 s.
  - Returns `{ url: '/media/lodging/<ws>/<id>.mp4', bytes }`.
  - `assertOwnGallery` requires every `video` item to be under `/media/lodging/<ws>/`.
- **Links**: no upload. The `https` check and the `caption` (title) are set in the
  "Thêm link video" dialog.
- Deleting an item does not delete the stored object. Orphan cleanup is out of scope
  (§10), as it is for product images today.

## 5. Web ("Ảnh & video" tab)

The tab label becomes "Ảnh & video". The tab has two views, and the open folder lives in
the URL search param `folder` so that Back works.

**Folder list (like Drive)**
- Rows show a thumbnail (first image, or a film icon), name, "12 ảnh · 1 video" and a ⋮
  menu (Đổi tên, Lên, Xuống, Xoá thư mục). Deleting a non-empty folder asks for
  confirmation.
- "Thư mục mới" opens a name dialog. Empty state: "Chưa có thư mục nào — tạo thư mục đầu
  tiên, ví dụ "Ngoài trời ban ngày"."
- The cover in use is shown at the top ("Ảnh bìa").

**Inside a folder**
- Header: ← Tất cả thư mục · folder name · "Thêm ảnh/video" (file picker that accepts
  jpeg/png/webp/mp4, also accepting drop on the whole grid) · "Thêm link video".
- Help line: "Bot gửi trước 8 ảnh đầu theo thứ tự này, khách muốn xem thêm thì gửi tiếp.
  Kéo thả để đổi thứ tự."
- Grid of tiles. Each tile has:
  - its **number** at the top left;
  - for images 1–8 a subtle "Bot gửi trước" mark (an accent ring plus a small label on
    tile 1);
  - a video tile with a ▶ badge and its duration when the browser can read it;
  - a link tile with a link icon and the host name.
- Numbering counts images only, because only images are paged (videos and links are sent
  on request). Videos and links show their own badge instead of a number.
- Reordering uses `@dnd-kit/sortable`, with a keyboard sensor and a live announcement.
  Each tile also has ⋮ → Lên / Xuống / Chuyển sang thư mục… / Đặt làm ảnh bìa / Sửa chú
  thích / Xoá.
- Multi-select (a checkbox on hover/focus, always visible on touch) offers "Chuyển sang
  thư mục…" and "Xoá".
- Uploads show per-file progress, using XHR for the video. Images are capped at 200 items
  per property and the UI shows the remaining count.
- Saving keeps today's model: edit a draft, then "Lưu" (TabSaveBar plus a dirty marker and
  the leave guard). The draft is the whole `gallery` plus `galleryCover`.
- List view covers (`properties-page`, `properties-table`) use `galleryCoverUrl`.

## 6. Bot

### 6.1 Bot product (`lodging/application/bot-product.ts`)

- `AccommodationDetails` (`commerce/lodging.schema.ts`) gains
  `albums: [{ id, name, items: [{kind, url, caption}] }]` (≤20). It is optional, defaults
  to `[]` and is only filled by lodging.
- The legacy `gallery` (flat images) stays for old commerce rows. For lodging it is filled
  with the flattened images (first 30) for compatibility.
- `imageUrls` = cover first, then the next images (max 5) as today.
- `catalog-context.ts` strips `albums` like `gallery`. The model sees only an `albums`
  summary: `[{ name, photos: n, videos: n, links: n }]`.

### 6.2 What the model can send (`ai/domain/image-allowlist.ts`, `output-tools.ts`)

- Album entries: id `a:<productId>:<folderIndex>`, label `"<product> – <folder> (N ảnh)"`.
  Listed for the focus products, up to 20 per product.
- Video entries: id `v:<productId>:<folderIndex>:<itemIndex>`, label
  `"<product> – <folder> – video: <caption or 'video N'>"`, for `video` and `link` items.
  Up to 10 per product.
- Single images stay addressable as today (`p:<productId>:<n>`, label with caption or
  folder name) for "send that one photo". The flat list is the folders' images in order,
  max 15.
- `send_message` gains:
  - `albumId?: string`. The server sends the **next 8 not-yet-sent images** of that folder
    in this conversation. "Already sent" means attachment URLs of bot messages in this
    conversation in the last 30 days, read through a new conversation facade method. When
    every image was already sent, it starts again from the first. The tool result tells
    the model `sent K, remaining R` so it can offer the rest (D3).
  - `videoId?: string`. One video per call. A `video` item is delivered as a video
    attachment in its own message. A `link` item is appended to the text as
    `caption: url`.
  - `imageIds` stays (≤3) for individual photos. `albumId` and `imageIds` are mutually
    exclusive in one call.
- Prompt `sales-agent@20` (hotel only; older versions are kept) says:
  - when the customer asks to see photos, choose the folder that fits and send it with
    `albumId`;
  - after an album, if `remaining > 0`, offer "Còn R ảnh nữa…";
  - send videos only when the customer asks for video/clip, or when the matching folder
    holds only videos;
  - never paste media URLs yourself.

### 6.3 Delivery (`conversation/application/jobs/reply-delivery.ts`, facades)

- The image album cap goes from 3 to 8 (Meta's limit is 10). The text bubbles go first,
  then one album message, as today. The per-picture fallback on album failure is kept.
- Video: `commitBotAttachments` (typed `image | video`) replaces the hard-coded
  `type: 'image'`. A video is its own message, `type: 'video'`.
- Bot history note (`reply-turns.ts`): outbound bot attachments are currently described
  with the customer's wording. They become "[Bot đã gửi N ảnh / 1 video]".
- The inbox already plays video. The playground renders video items with `<video>`. The
  website widget keeps showing the first image only (out of scope, §10).

## 7. Errors and limits

| Case | Behaviour |
|------|-----------|
| Video > 25 MB | 413, toast "Video quá 25 MB — hãy thêm dưới dạng link YouTube/Drive." |
| Not an MP4 | 400 `INVALID_VIDEO`, toast "Chỉ nhận video MP4." |
| Link not https | inline field error |
| > 200 items / > 20 folders | add buttons disabled with the reason; the server returns 400 |
| Duplicate folder name | inline error in the name dialog; the server returns 400 |
| Folder with images but the album send fails on Meta | today's per-picture fallback |
| Video too big for Meta at send time | the delivery error is logged in the trace; the bot's text was already sent |

## 8. Testing

- Contracts:
  - folder and item schema (kinds, limits, unique ids/names, cover must be an image url);
  - `MEDIA_PATH` accepts lodging mp4 and rejects look-alikes;
  - `galleryCoverUrl`.
- Migration integration test: a flat 12-photo gallery becomes one "Ảnh chung" folder in
  order; `[]` stays; running again changes nothing.
- Backend:
  - video upload (size limit 413, ftyp sniff, key, ws ownership);
  - `assertOwnGallery` for video items;
  - `toBotProduct` albums mapping;
  - album allowlist and paging (next 8, wrap-around, `remaining`);
  - delivery of an 8-photo album and of a video attachment;
  - history note wording.
- Web:
  - folder list (create, rename, reorder, delete with confirmation);
  - folder view (numbering, "Bot gửi trước" on the first 8 images, reorder by keyboard
    and menu, move to another folder, cover, link dialog validation);
  - save PATCH body.
- Evals: the lodging eval fixtures move to folders. One new eval: "cho xem phòng ngủ"
  sends the right album, and "xem thêm" sends the next page.

## 9. Docs

- Update `docs/lodging.md`, `docs/06-ai-engine.md`, `docs/05-data-model.md`,
  `docs/meta-inbox.md` and `docs/02-functional-requirements.md` (BOT-10).
- Update the module docs: lodging, ai, conversation and commerce `MODULE.md`.
- New ADR-026 "Lodging media folders and paged bot albums". It records the new upload
  path, the album cap 3 → 8 that deviates from ADR-015, and the `albumId` / `videoId`
  tool fields.

## 10. Out of scope

- Google Drive folder import.
- Nested folders.
- Linking folders to rooms.
- Video transcoding or compression.
- Thumbnails generated on the server.
- Deleting orphaned objects.
- Album and video rendering in the website widget.
- Folders for retail products.
