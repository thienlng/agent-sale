import { and, eq, schema, type Database } from '@agent-sales/db';
import { newId, type WorkspaceId } from '@agent-sales/shared';

import { IMAGE_EXTENSIONS } from '../../../../common/storage/image-bytes.js';
import type { PublicObjectStorage } from '../../../../common/storage/public-object-storage.js';
import { allImageUrls, classifyImageUrls, rewriteImageUrls } from '../../domain/image-import.js';
import { ownImageProblem, ownImagePrefix } from '../../domain/own-image.js';
import { downloadImage, ImageDownloadError, type DownloadedImage } from './download-image.js';

export interface WorkspaceImportReport {
  found: number;
  imported: number;
  alreadyStored: number;
  failed: { count: number; reasons: Record<string, number> };
}

export interface ImportOptions {
  dryRun?: boolean;
  workspaceId?: string;
  download?: (url: string) => Promise<DownloadedImage>;
}

const emptyReport = (): WorkspaceImportReport => ({
  found: 0,
  imported: 0,
  alreadyStored: 0,
  failed: { count: 0, reasons: {} },
});

/**
 * Copies every product picture / lodging gallery photo that is not yet a Rapiz-stored file of
 * its own workspace into storage and rewrites the URL in place. One transaction per product;
 * idempotent; one upload per (workspace, source URL) per run. `db` is the RLS-free system
 * connection, so every query filters by workspace explicitly. Reports counts and reasons only.
 */
export async function importProductImages(
  db: Database,
  storage: PublicObjectStorage,
  options: ImportOptions = {},
): Promise<Record<string, WorkspaceImportReport>> {
  const download = options.download ?? ((u: string) => downloadImage(u));
  const rows = await db
    .select({
      id: schema.products.id,
      workspaceId: schema.products.workspaceId,
      imageUrls: schema.products.imageUrls,
      accommodation: schema.products.accommodation,
    })
    .from(schema.products)
    .where(options.workspaceId ? eq(schema.products.workspaceId, options.workspaceId) : undefined)
    .orderBy(schema.products.workspaceId, schema.products.id);

  const report: Record<string, WorkspaceImportReport> = {};
  const done = new Map<string, { url: string } | { reason: string }>();

  for (const row of rows) {
    const ws = row.workspaceId as WorkspaceId;
    const r = (report[ws] ??= emptyReport());
    const holder = { imageUrls: row.imageUrls, accommodation: row.accommodation };
    const isOwn = (u: string) => ownImageProblem(u, ws, storage) === null;
    const { stored, external } = classifyImageUrls(holder, isOwn);
    r.alreadyStored += stored;
    r.found += external.length;
    if (options.dryRun || external.length === 0) continue;

    const fail = (reason: string) => {
      r.failed.count += 1;
      r.failed.reasons[reason] = (r.failed.reasons[reason] ?? 0) + 1;
    };
    try {
      const replacements = new Map<string, string>();
      for (const src of external) {
        const key = `${ws}|${src}`;
        let result = done.get(key);
        if (!result) {
          try {
            const img = await download(src);
            const url = await storage.put(
              `${ownImagePrefix(ws)}${newId()}.${IMAGE_EXTENSIONS[img.mime]}`,
              img.bytes,
              img.mime,
            );
            result = { url };
          } catch (e) {
            result = { reason: e instanceof ImageDownloadError ? e.message : 'storage_error' };
          }
          done.set(key, result);
        }
        if ('url' in result) replacements.set(src, result.url);
        else fail(result.reason);
      }
      if (replacements.size === 0) continue;

      // Downloads can take long: re-read the row under lock and rewrite the fresh values,
      // so a merchant edit made meanwhile survives.
      const applied = await db.transaction(async (tx) => {
        const [fresh] = await tx
          .select({
            imageUrls: schema.products.imageUrls,
            accommodation: schema.products.accommodation,
          })
          .from(schema.products)
          .where(and(eq(schema.products.id, row.id), eq(schema.products.workspaceId, ws)))
          .for('update');
        if (!fresh) return 0;
        const next = rewriteImageUrls(fresh, replacements);
        if (!next) return 0;
        await tx
          .update(schema.products)
          .set({
            imageUrls: next.imageUrls,
            accommodation: next.accommodation,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.products.id, row.id), eq(schema.products.workspaceId, ws)));
        return allImageUrls(fresh).filter((u) => replacements.has(u)).length;
      });
      r.imported += applied;
    } catch {
      fail('product_error');
    }
  }
  return report;
}

export const importFailures = (report: Record<string, WorkspaceImportReport>): number =>
  Object.values(report).reduce((n, r) => n + r.failed.count, 0);
