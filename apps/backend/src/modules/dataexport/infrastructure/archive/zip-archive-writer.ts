import { closeSync, openSync, statSync, writeSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportTable } from '@agent-sales/contracts';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import type {
  ArchiveCounts,
  ExportArchiveWriter,
  ExportFileStorage,
  WrittenArchive,
} from '../../application/ports/export-files.js';
import { CSV_BOM, csvLine } from '../../domain/csv.js';

const encoder = new TextEncoder();
/** Media copied per export at most; the rest stay as links (README says how many). */
const MAX_MEDIA_FILES = 20_000;

/**
 * Streams the archive to a temp file: fflate emits chunks synchronously and they are written
 * synchronously, so memory stays at one page of rows or one media chunk whatever the data size.
 */
export class ZipArchiveWriter implements ExportArchiveWriter {
  constructor(
    private readonly media: Pick<ExportFileStorage, 'readMedia'>,
    private readonly dir: string = tmpdir(),
  ) {}

  async write(input: {
    tables: readonly ExportTable[];
    includeMedia: boolean;
    readme: (counts: ArchiveCounts) => string;
  }): Promise<WrittenArchive> {
    const folder = await mkdtemp(join(this.dir, 'rapiz-export-'));
    const path = join(folder, 'export.zip');
    const cleanup = () => rm(folder, { recursive: true, force: true });
    const fd = openSync(path, 'w', 0o600);
    let failure: Error | null = null;
    let done = false;
    const zip = new Zip((err, chunk, final) => {
      if (err) failure = err;
      else if (chunk.length) writeSync(fd, chunk);
      if (final) done = true;
    });
    try {
      const counts: ArchiveCounts = { rows: {}, mediaFiles: 0, mediaSkipped: 0 };
      const mediaUrls = new Set<string>();
      for (const table of input.tables) {
        const entry = new ZipDeflate(table.file, { level: 6 });
        zip.add(entry);
        entry.push(encoder.encode(CSV_BOM + csvLine(table.columns)));
        const mediaAt = input.includeMedia
          ? (table.mediaColumns ?? []).map((c) => table.columns.indexOf(c)).filter((i) => i >= 0)
          : [];
        let rows = 0;
        for await (const page of table.rows()) {
          entry.push(encoder.encode(page.map(csvLine).join('')));
          rows += page.length;
          for (const row of page)
            for (const i of mediaAt) for (const url of urlsOf(row[i])) mediaUrls.add(url);
        }
        entry.push(new Uint8Array(0), true);
        counts.rows[table.file] = rows;
        if (failure) throw failure;
      }
      const copied = new Set<string>();
      for (const url of mediaUrls) {
        if (copied.size >= MAX_MEDIA_FILES) {
          counts.mediaSkipped++;
          continue;
        }
        const object = await this.media.readMedia(url).catch(() => null);
        if (!object || copied.has(object.key)) {
          if (!object) counts.mediaSkipped++;
          continue;
        }
        copied.add(object.key);
        const entry = new ZipPassThrough(`media/${object.key}`);
        zip.add(entry);
        for await (const chunk of object.body) entry.push(chunk);
        entry.push(new Uint8Array(0), true);
        counts.mediaFiles++;
        if (failure) throw failure;
      }
      const readme = new ZipDeflate('README.txt', { level: 6 });
      zip.add(readme);
      readme.push(encoder.encode(CSV_BOM + input.readme(counts)), true);
      zip.end();
      if (failure) throw failure;
      if (!done) throw new Error('zip did not finish');
      closeSync(fd);
      return { path, sizeBytes: statSync(path).size, counts, cleanup };
    } catch (e) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
      await cleanup();
      throw e;
    }
  }
}

/**
 * Candidate URLs in a media cell: a string, a JSON value (arrays and objects are walked, e.g. a
 * lodging gallery of folders of `{kind, url}` items) or a Postgres text[] literal. Strings that are
 * not Rapiz media are dropped later by `readMedia`.
 */
function urlsOf(cell: unknown, depth = 0): string[] {
  if (depth > 6 || cell === null || cell === undefined) return [];
  if (typeof cell === 'string') {
    const s = cell.trim();
    if (!s) return [];
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        return urlsOf(JSON.parse(s) as unknown, depth + 1);
      } catch {
        if (s.startsWith('{') && s.endsWith('}'))
          return s
            .slice(1, -1)
            .split(',')
            .map((x) => x.replace(/^"|"$/g, ''))
            .filter(Boolean);
        return [];
      }
    }
    return /^(https?:\/\/|\/media\/|[a-z0-9]+\/)/i.test(s) && !/\s/.test(s) ? [s] : [];
  }
  if (Array.isArray(cell)) return cell.flatMap((x) => urlsOf(x, depth + 1));
  if (typeof cell === 'object') return Object.values(cell).flatMap((x) => urlsOf(x, depth + 1));
  return [];
}
