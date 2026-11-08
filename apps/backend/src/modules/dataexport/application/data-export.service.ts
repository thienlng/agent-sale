import { createHash, randomBytes } from 'node:crypto';

import type { DataExportDto, DataExportLink, DataExportList } from '@agent-sales/contracts';
import { type WorkspaceId, newId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  EXPORT_DAILY_LIMIT,
  EXPORT_LINK_TTL_MS,
  type DataExportRecord,
  exportFileName,
} from '../domain/data-export.js';
import {
  DataExportDailyLimitError,
  DataExportInProgressError,
  DataExportNotFoundError,
  DataExportNotReadyError,
  DataExportUnavailableError,
} from '../domain/dataexport.errors.js';
import { DATA_EXPORT_STORE, type DataExportStore } from './ports/data-export-store.js';
import { EXPORT_FILE_STORAGE, type ExportFileStorage } from './ports/export-files.js';

export const DOWNLOAD_PATH = '/api/v1/data-exports/download/';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toDto(r: DataExportRecord): DataExportDto {
  return {
    id: r.id,
    status: r.status,
    includeMedia: r.includeMedia,
    sizeBytes: r.sizeBytes,
    errorCode: r.errorCode,
    requestedByName: r.requestedByName,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
  };
}

/** Settings → Dữ liệu: request, list and download whole-workspace exports (SET-10). */
@Injectable()
export class DataExportService {
  constructor(
    @Inject(DATA_EXPORT_STORE) private readonly store: DataExportStore,
    @Inject(EXPORT_FILE_STORAGE) private readonly files: ExportFileStorage,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async list(ws: WorkspaceId, now = new Date()): Promise<DataExportList> {
    const [rows, usedToday] = await Promise.all([
      this.store.list(ws, 20),
      this.store.countSince(ws, new Date(now.getTime() - 24 * 3600_000)),
    ]);
    return { data: rows.map(toDto), usedToday, dailyLimit: EXPORT_DAILY_LIMIT };
  }

  async request(
    ws: WorkspaceId,
    actor: { userId: string; name: string | null },
    includeMedia: boolean,
    now = new Date(),
  ): Promise<DataExportDto> {
    if (!this.files.available()) throw new DataExportUnavailableError();
    if (await this.store.hasActive(ws)) throw new DataExportInProgressError();
    const used = await this.store.countSince(ws, new Date(now.getTime() - 24 * 3600_000));
    if (used >= EXPORT_DAILY_LIMIT) throw new DataExportDailyLimitError(EXPORT_DAILY_LIMIT);
    const created = await this.store.create({
      id: newId(),
      workspaceId: ws,
      requestedByUserId: actor.userId,
      requestedByName: actor.name,
      includeMedia,
    });
    return toDto(created);
  }

  async createLink(ws: WorkspaceId, id: string, now = new Date()): Promise<DataExportLink> {
    const record = await this.store.get(ws, id);
    if (!record) throw new DataExportNotFoundError();
    if (record.status !== 'ready') throw new DataExportNotReadyError();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + EXPORT_LINK_TTL_MS);
    if (!(await this.store.setLink(ws, id, hashToken(token), expiresAt)))
      throw new DataExportNotReadyError();
    return { url: `${DOWNLOAD_PATH}${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** The one-time link: valid once, within 5 minutes, while the export is ready. */
  async download(
    token: string,
    now = new Date(),
  ): Promise<{ fileName: string; sizeBytes: number | null; body: AsyncIterable<Uint8Array> }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DataExportNotFoundError();
    const record = await this.store.consumeLink(hashToken(token), now);
    if (!record?.objectKey) throw new DataExportNotFoundError();
    const business = await this.workspaces.getById(record.workspaceId as WorkspaceId);
    const file = await this.files.open(record.objectKey);
    return {
      fileName: exportFileName(business.name, record.createdAt),
      sizeBytes: file.sizeBytes ?? record.sizeBytes,
      body: file.body,
    };
  }
}
