# Product Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Product pictures (and lodging gallery photos) are uploaded files stored in Rapiz's own S3-compatible storage; external image links are no longer accepted, and existing linked images are imported into storage.

**Architecture:** One generic public-object storage adapter in `apps/backend/src/common/storage` (moved from the knowledge module, which keeps using it). `commerce` gets an upload endpoint that validates the bytes and stores them under a per-workspace key, and rejects any product/gallery image URL that is not under the storage's public URL. The web product and accommodation forms replace the URL input with a file picker that resizes in the browser before upload. A one-off CLI imports existing external images. Dev runs SeaweedFS (S3) in Docker, exposed through the dev tunnel proxy at `/media/`.

**Tech Stack:** NestJS, Zod contracts, @aws-sdk/client-s3, React (TanStack Query, shadcn), canvas resize in the browser, Docker (SeaweedFS), Vitest, Testcontainers.

**Spec (owner decision 2026-10-30, chat):** "phải lưu về storage của mình… Bỏ hẳn cái link đi. Yêu cầu người dùng up ảnh, không dùng link." Context: TinyMind's 295 product images were links to another shop's Shopify CDN; Meta intermittently failed to fetch them, so picture albums were rejected (#100/2018047), while 12 photos hosted by Rapiz always went through.

## Global Constraints

- Work only in `/home/kenknight/Workspace/agent-sale-images` (branch `feat/product-image-upload`, from origin/main 7ff22b2). Never push or merge. Rules: `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md` (modules reach each other only through `api/` facades; shared infrastructure lives in `apps/backend/src/common`).
- English for code/docs/commits; Vietnamese only in `packages/i18n` vi files.
- Conventional Commits with valid scopes (`commerce`, `knowledge`, `web`, `db`, `docs`, `repo`, `backend`); every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `--no-verify`; stage only your own files.
- Accepted upload formats: `image/jpeg`, `image/png`, `image/webp`, verified by magic bytes (reuse the existing `decodeImage` logic). Max decoded size per upload: **1 MiB** (the browser resizes first: longest side 1600 px, JPEG quality 0.85). Request body limit 2 MiB.
- Storage key: `products/<workspaceId>/<uuidv7>.<ext>`; public URL = `${S3_PUBLIC_URL}/<key>`. Never fall back to local disk.
- Only URLs that start with `${S3_PUBLIC_URL}/products/<the same workspaceId>/` are accepted in `imageUrls` and accommodation `gallery[].url` on create/update. Anything else → validation error code `IMAGE_NOT_UPLOADED`. When storage is not configured, uploads answer 503 `MEDIA_STORAGE_UNAVAILABLE` and the image rule rejects every new image (existing stored values are left untouched until edited).
- `MAX_PRODUCT_IMAGES` stays 5; gallery max stays 30.
- No secrets or tokens in logs; never log image bytes or customer data.
- Do NOT run `pnpm check` (the controller runs the gate). Run the focused commands each task names.

---

### Task 1: Dev object storage (SeaweedFS) and tunnel route

**Files:** `infra/docker/docker-compose.local.yml`, `infra/docker/seaweedfs-s3.json` (new), `scripts/dev-tunnel-proxy.mjs` (+ its test `scripts/dev-tunnel-proxy.test.mjs`), `.env.example`, `docs/10-operations-and-deployment.md`.

- [ ] Add service `object-storage` using `chrislusf/seaweedfs:latest` (already pulled locally), command `server -s3 -s3.port=9000 -s3.config=/etc/seaweedfs/s3.json -dir=/data`, port `9000:9000`, volume `s3data:/data`, mounting `seaweedfs-s3.json` read-only. The JSON defines one identity `rapiz` with the `.env.example` keys (`minioadmin`/`minioadmin`, actions Admin, Read, Write, List, Tagging) and an `anonymous` identity with action `Read` only (public reads, no listing).
- [ ] Replace the stale "MinIO no longer publishes…" comment with a short note on why SeaweedFS.
- [ ] Tunnel proxy: requests to `/media/<rest>` are proxied to `http://127.0.0.1:9000/<S3_BUCKET or rapiz-local>/<rest>` (GET/HEAD only; other methods 405), preserving `Content-Type`, `Content-Length`, `Cache-Control`. Add a test in the proxy's existing test file style.
- [ ] `.env.example`: comment that for the dev tunnel `S3_PUBLIC_URL=https://<tunnel host>/media`.
- [ ] Docs: `docs/10-operations-and-deployment.md` local section — object storage service, bucket creation, public read.
- [ ] Verify: `docker compose -f infra/docker/docker-compose.local.yml config` parses; `node --test scripts/dev-tunnel-proxy.test.mjs` (or the repo's way of running it — check package.json) passes. Do NOT start or stop containers of the running dev stack (the controller does).
- [ ] Commit `build(repo): run SeaweedFS as local object storage behind the dev tunnel` (scope `repo` if `build` type is valid; otherwise `chore(repo)`).

### Task 2: Shared storage adapter and the product image upload endpoint

**Files:**
- Create `apps/backend/src/common/storage/public-object-storage.ts` (the S3 adapter moved from `apps/backend/src/modules/knowledge/infrastructure/s3-bot-media-storage.ts`, renamed `S3PublicObjectStorage`, same behaviour; plus `isPublicUrlUnder(url, prefix)` helper or a `publicUrl` getter) and `apps/backend/src/common/storage/image-bytes.ts` (moved `decodeImage` + errors from `knowledge/domain/image-upload.ts`, size limit parameter, default 1 MiB). Knowledge keeps working through re-exports or updated imports (its tests must stay green).
- Contracts: `packages/contracts/src/commerce/product-images.schema.ts` + route in the commerce routes file: `POST /products/images` body `{ mimeType: 'image/jpeg'|'image/png'|'image/webp', base64 }` (same base64 regex/max as `UploadBotImageRequest`), response 201 `{ url: string }`.
- Backend commerce: controller method (permission: the same one that guards product create/update — read it), `bodyLimit: 2_097_152`, application service `ProductImageService.upload(ws, input)` → decode/verify → key `products/<ws>/<uuidv7>.<ext>` → storage.put → `{url}`; module wiring builds `S3PublicObjectStorage` from `S3_*` env exactly like the knowledge module.
- Tests: unit (service: bad magic bytes → 400 `INVALID_IMAGE`; > 1 MiB → 400; storage down → 503; key prefix contains the workspace id), HTTP test in the style of the existing commerce/media controller specs, knowledge media tests still green.
- [ ] TDD; run `cd apps/backend && npx vitest run src/modules/commerce src/modules/knowledge src/common` + typecheck + `pnpm arch`.
- [ ] Commit(s) `refactor(backend): share the public object storage adapter` and `feat(commerce): upload product images to Rapiz storage`.

### Task 3: Accept only Rapiz-stored images on products and galleries

**Files:** commerce application (product create/update and accommodation create/update paths), domain helper `domain/own-image.ts` (`ownImageProblem(url, publicUrl, workspaceId)`), errors mapping, tests; `packages/contracts` doc comments for `ProductImageUrl` and gallery `Image` ("must be a URL returned by POST /products/images").
- [ ] Rule from Global Constraints. An update that keeps an image already stored on the product is NOT exempt: external URLs must be gone (the import CLI runs first in every environment; say so in the docs).
- [ ] Tests: create/update with an external https URL → `IMAGE_NOT_UPLOADED`; another workspace's storage URL → rejected; own storage URL → accepted; gallery same rules; storage not configured → any new image rejected.
- [ ] Existing commerce unit/integration specs that use `https://img.example.com/...` fixtures: switch them to a configured public URL fixture (do not delete tests).
- [ ] Run commerce unit + `apps/backend/test/commerce.integration.spec.ts` + lodging integration spec (`apps/backend/test/lodging.integration.spec.ts`), typecheck.
- [ ] Commit `feat(commerce): accept only images stored by Rapiz`.

### Task 4: Web upload UI for products and lodging galleries

**Files:** `apps/web/src/features/commerce/components/product-images-editor.tsx` (+ test), the accommodation gallery editor inside `accommodation-form.tsx` (+ test), `apps/web/src/features/commerce/api/commerce.ts` (`useUploadProductImage`), `apps/web/src/features/commerce/lib/resize-image.ts` (+ test), `packages/i18n/src/messages/{vi,en}/*.json` (the file that holds `products.form.*`).
- [ ] Remove the URL input entirely. Add: a drop zone + "Chọn ảnh" button (`<input type="file" accept="image/jpeg,image/png,image/webp" multiple>`), per-file upload with a spinner, thumbnails with remove and move-left/right buttons (keyboard accessible), counter "x/5". Files beyond the remaining slots are ignored with a toast.
- [ ] `resizeImage(file)`: decode with `createImageBitmap`, scale so the longest side ≤ 1600 px, draw on a canvas, export JPEG quality 0.85 → base64; a file the browser cannot decode (e.g. HEIC) → error toast `products.form.imageUnreadable`. Unit-test the size math with a mocked canvas.
- [ ] Errors: `INVALID_IMAGE`, 413/too large, `MEDIA_STORAGE_UNAVAILABLE`, generic — i18n vi/en.
- [ ] Gallery: same picker; each uploaded photo gets an empty caption input that must be filled (existing validation).
- [ ] Tests (Testing Library): uploading two files calls the API twice and shows two thumbnails; remove and reorder update the value; no URL input exists; error toast on failure. Rebuild `packages/i18n` before web tests.
- [ ] Run `cd apps/web && npx vitest run src/features/commerce --testTimeout=30000` (loaded host), web typecheck, eslint touched files, `pnpm --filter @agent-sales/web build`.
- [ ] Commit `feat(web): upload product and gallery pictures instead of pasting links`.

### Task 5: Import existing external images into storage

**Files:** `apps/backend/src/cli/product-images-import.ts` (+ script `product-images:import` in `apps/backend/package.json`), unit tests for the pure parts, docs (`apps/backend/src/modules/commerce/MODULE.md`, `docs/10-operations-and-deployment.md`).
- [ ] Usage: `pnpm --filter @agent-sales/backend product-images:import [--dry-run] [--workspace <id>]`. Uses DATABASE_SYSTEM_URL (like the other CLIs) and the same storage adapter and `S3_*` env.
- [ ] For every product `image_urls` entry and accommodation `gallery[].url` that is not under `${S3_PUBLIC_URL}/products/<its workspace>/`: download (15 s timeout, follow ≤ 3 redirects, max 10 MiB, `Accept: image/jpeg,image/png,image/webp` so CDNs that negotiate send a supported format), verify magic bytes (JPEG/PNG/WebP; anything else → skipped and reported), upload with a 10 MiB limit for imports, then rewrite the URL in place (same order). One transaction per product; idempotent (a second run changes nothing). Same source URL inside one run is uploaded once.
- [ ] Report: per workspace counts (found, imported, already stored, failed with reason); exit code 1 if anything failed. `--dry-run` downloads nothing and writes nothing, only counts.
- [ ] Tests: the URL classification and rewrite logic as pure functions; an integration test with a local HTTP server serving a PNG and a 404, against the Testcontainers Postgres and a fake storage.
- [ ] Commit `feat(commerce): import linked product images into Rapiz storage`.

### Controller gate (not a subagent task)

Start SeaweedFS, create the bucket, set the dev `S3_*` env, restart the dev servers, run the import on the dev database (after a pg_dump backup), verify a TinyMind album of 3 pictures and the Villas gallery send through Messenger, `pnpm check`, push, open the PR.
