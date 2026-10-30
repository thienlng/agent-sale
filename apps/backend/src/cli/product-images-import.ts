/* eslint-disable no-console -- CLI entrypoint */
import { parseArgs } from 'node:util';

import { createDb } from '@agent-sales/db';

import { S3PublicObjectStorage } from '../common/storage/public-object-storage.js';
import {
  importFailures,
  importProductImages,
} from '../modules/commerce/infrastructure/image-import/import-product-images.js';

/**
 * `pnpm --filter @agent-sales/backend product-images:import [--dry-run] [--workspace <id>]`
 *
 * Copies every product picture and lodging gallery photo that is still an external link into
 * Rapiz's S3-compatible storage (`products/<workspaceId>/<uuidv7>.<ext>`) and rewrites the URL
 * in place, so the "only Rapiz-stored images" rule holds for existing data. Needs
 * DATABASE_SYSTEM_URL and S3_ENDPOINT / S3_BUCKET / S3_PUBLIC_URL / S3_ACCESS_KEY / S3_SECRET_KEY.
 * Idempotent; `--dry-run` downloads and writes nothing and only counts. Prints per-workspace
 * counts (no URLs); exit code 1 when any picture failed.
 */
const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    workspace: { type: 'string' },
  },
});
const env = process.env;
const url = env['DATABASE_SYSTEM_URL'];
const need = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_URL', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
const dryRun = values['dry-run'] === true;
if (!url || need.some((k) => !env[k])) {
  console.error(
    'usage: product-images:import [--dry-run] [--workspace <id>]\n' +
      `needs DATABASE_SYSTEM_URL and ${need.join(', ')}`,
  );
  process.exit(1);
}

const storage = new S3PublicObjectStorage({
  endpoint: env['S3_ENDPOINT'],
  bucket: env['S3_BUCKET'],
  publicUrl: env['S3_PUBLIC_URL'],
  accessKey: env['S3_ACCESS_KEY'],
  secretKey: env['S3_SECRET_KEY'],
});
const { db, close } = createDb({ url, max: 1 });
let failed = 0;
try {
  const report = await importProductImages(db, storage, {
    dryRun,
    ...(values.workspace ? { workspaceId: values.workspace } : {}),
  });
  console.log(JSON.stringify(report, null, 2));
  failed = importFailures(report);
  console.log(
    dryRun
      ? 'dry run: nothing was downloaded or written'
      : `done; ${failed} picture(s) failed (re-run is safe)`,
  );
} finally {
  await close();
}
process.exit(failed > 0 ? 1 : 0);
