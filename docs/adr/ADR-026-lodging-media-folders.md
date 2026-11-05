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
   ≤ 25 MiB, ISO-BMFF `ftyp` check) stores `lodging/<ws>/<uuidv7>.mp4` through the module's own
   `S3PublicObjectStorage` with a 120 s request timeout; `MEDIA_PATH` accepts that key family. The
   whole file is buffered in the api process before the put. Longer videos are https links sent as
   text. Photos keep going through `POST /products/images`.
3. **Paged albums.** The bot product carries `accommodation.albums`. The model sees album ids
   (`a:<product>:<folder index>`) and video ids (`v:<product>:<folder index>:<item index>`);
   `send_message` gains `albumId` and `videoId` (one per call). An `albumId` send takes the next
   ≤ 8 photos of the folder, in the owner's order, whose URL is not in `ReplyOptions.sentMediaUrls`;
   the result reports `remaining`. When every photo was already sent it restarts from photo 1, and
   the first restart page of a folder in a turn reports `remaining: 0` (an unordered sent set cannot
   page a re-cycle across turns); later calls in the same turn page on from the restart point. An
   uploaded video is its own video message (Meta fetches it before answering, so a Messenger send
   with a video waits up to 60 s instead of 15 s); a link is appended to the text as "title: url"
   (the caption, or "video n"). `albumId` and `imageIds` are exclusive.
4. **Who knows what was sent.** The conversation processor computes the bot's sent attachment URLs
   of the last 30 days from the context it already loaded (the newest 200 messages, so in effect
   "last 30 days or last 200 messages, whichever is less") and passes them as
   `ReplyOptions.sentMediaUrls`; the playground client sends `PlaygroundRequest.sentMediaUrls`
   itself (images only). No conversation facade method is added; ai never reads conversation tables.
5. **Album cap 3 → 8.** One album message carries up to 8 pictures (Meta accepts 10); this deviates
   from ADR-015 §2, which kept 3 picture ids per `send_message`. `imageIds` stays at 3. Delivery order
   per send: text → album → video; with quick replies album → video → text, so the buttons stay on
   the last message.
6. **Prompt.** Hotel bots use `sales-agent@20` (= @18 with the folder rules); older versions stay.

## Options considered

1. **A separate `lodging_media` table** (one row per item): proper ordering columns and per-item
   ownership, but a second write path, joins on every bot read and a bigger migration for at most
   200 small items that are always read and written together. Rejected.
2. **Let the model pick photos by caption, more of them** (raise `imageIds` to 8): needs captions on
   every photo (the owner's complaint) and cannot page through a folder. Rejected.
3. **Store videos through the commerce image route** (one upload path): commerce would own lodging
   media and its 1 MiB base64 JSON body cannot carry 25 MiB. Rejected.
4. **A conversation facade query for sent media** (ai asks conversation per album send): a new
   cross-module dependency from ai to conversation and a query per tool call, while the processor
   already holds the recent messages. Rejected.
5. **Import Google Drive folders**: OAuth scope and sync burden for a v1 the owner can do by drag and
   drop. Deferred (spec §10).

## Consequences

- Positive: owners upload as they already organise; the bot sends coherent pages in the owner's
  order and offers more; videos reach Messenger natively.
- Negative: a 25 MiB video is buffered in the api process while it uploads; deleting an item never
  deletes its object (no orphan cleanup yet); "already sent" is bounded by the 200 loaded messages,
  so in a long conversation an older album may be sent again; the website widget still shows only
  the first image of a message and no video.
- Rollback: migration 0066 rewrites `gallery` into folders, and the release before it reads only
  the flat list (it fails with 500 on a folder row). Rolling back past this release, by
  `deploy.sh rollback` or the automatic rollback after a failed health check, therefore needs the
  hand-run reverse SQL `packages/db/sql/rollback-0066-lodging-media-folders.sql` first
  (docs/runbooks/deploy-vps.md). It keeps images only; videos, links and folder names are lost.
  The short window between `migrate` and the new containers starting is accepted.
- Follow-ups: orphan cleanup for product pictures and lodging videos; streaming the upload to
  storage; server-side thumbnails or transcoding; album and video rendering in the website widget.
