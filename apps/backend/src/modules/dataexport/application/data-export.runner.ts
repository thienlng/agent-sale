import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  NOTIFICATION_FACADE,
  type NotificationFacade,
  type NotifyInput,
} from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { DataExportRunner } from '../api/dataexport.runner.js';
import {
  EXPORT_KEEP_DAYS,
  EXPORT_LEASE_MS,
  EXPORT_MAX_ATTEMPTS,
  type DataExportRecord,
  exportObjectKey,
} from '../domain/data-export.js';
import { DATA_EXPORT_STORE, type DataExportStore } from './ports/data-export-store.js';
import {
  EXPORT_ARCHIVE_WRITER,
  EXPORT_FILE_STORAGE,
  type ExportArchiveWriter,
  type ExportFileStorage,
  type WrittenArchive,
} from './ports/export-files.js';
import { renderReadme } from './readme.js';

export const EXPORT_SOURCES = Symbol('EXPORT_SOURCES');
export const SETTINGS_DATA_PATH = '/app/settings/data';

/** Stable failure codes (`data_exports.error_code`); logs carry the code, never row content. */
type StepCode = 'source_failed' | 'upload_failed';
const stepError = (code: StepCode): Error & { exportCode: StepCode } =>
  Object.assign(new Error(code), { exportCode: code });
const stepCode = (e: unknown): string =>
  e instanceof Error && 'exportCode' in e ? String(e.exportCode) : 'export_failed';

/**
 * Worker side of the data export (SET-10): expires old files, then builds one queued export per
 * tick (ZIP on local disk → private bucket) and notifies the requester.
 */
@Injectable()
export class DataExportRunnerImpl implements DataExportRunner {
  readonly #log = new Logger('DataExportRunner');

  constructor(
    @Inject(DATA_EXPORT_STORE) private readonly store: DataExportStore,
    @Inject(EXPORT_FILE_STORAGE) private readonly files: ExportFileStorage,
    @Inject(EXPORT_ARCHIVE_WRITER) private readonly writer: ExportArchiveWriter,
    @Inject(EXPORT_SOURCES) private readonly sources: readonly WorkspaceExportSource[],
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(NOTIFICATION_FACADE) private readonly notifications: NotificationFacade,
  ) {}

  async tick(now = new Date()): Promise<number> {
    for (const old of await this.store.expireDue(now, 20)) {
      if (old.objectKey) await this.files.remove(old.objectKey).catch(() => undefined);
    }
    if (!this.files.available()) return 0;
    const job = await this.store.claim(now, EXPORT_LEASE_MS, EXPORT_MAX_ATTEMPTS);
    if (!job) return 0;
    await this.#run(job, now);
    return 1;
  }

  async #run(job: DataExportRecord, now: Date): Promise<void> {
    const ws = job.workspaceId as WorkspaceId;
    let archive: WrittenArchive | null = null;
    try {
      const business = await this.workspaces.getById(ws);
      const locale = await this.notifications.recipientLocale(job.requestedByUserId);
      const tables = [...this.sources.flatMap((s) => s.exportTables(ws)), await this.#people(ws)];
      archive = await this.writer
        .write({
          tables,
          includeMedia: job.includeMedia,
          readme: (counts) =>
            renderReadme(locale, {
              businessName: business.name,
              createdAt: job.createdAt,
              counts,
              includeMedia: job.includeMedia,
            }),
        })
        .catch(() => {
          throw stepError('source_failed');
        });
      const key = exportObjectKey(ws, job.id);
      await this.files.upload(key, archive.path, archive.sizeBytes).catch(() => {
        throw stepError('upload_failed');
      });
      const at = new Date();
      await this.store.finishReady(job.id, {
        objectKey: key,
        sizeBytes: archive.sizeBytes,
        at,
        expiresAt: new Date(at.getTime() + EXPORT_KEEP_DAYS * 86_400_000),
      });
      this.#log.log(`export ${job.id} ready (${archive.sizeBytes} bytes)`);
      await this.#notify(job, 'dataexport.ready', locale, business.name);
    } catch (e) {
      const code = stepCode(e);
      this.#log.error(`export ${job.id} failed: ${code}`);
      await this.store.finishFailed(job.id, code, now);
      const locale = await this.notifications
        .recipientLocale(job.requestedByUserId)
        .catch(() => 'vi' as const);
      await this.#notify(job, 'dataexport.failed', locale, null);
    } finally {
      await archive?.cleanup();
    }
  }

  /** Names and emails of everyone who was a member (users are global; read through identity). */
  async #people(ws: WorkspaceId): Promise<ExportTable> {
    const members = await this.workspaces.listMembers(ws, { includeRemoved: true });
    const rows: (string | null)[][] = [];
    for (const m of members) {
      const p = await this.identity.profile(m.userId as UserId);
      rows.push([m.userId, p?.name ?? null, p?.email ?? null]);
    }
    return {
      file: 'people.csv',
      columns: ['user_id', 'name', 'email'],
      async *rows() {
        if (rows.length) yield rows;
      },
    };
  }

  async #notify(
    job: DataExportRecord,
    type: 'dataexport.ready' | 'dataexport.failed',
    locale: 'vi' | 'en',
    businessName: string | null,
  ): Promise<void> {
    const accountId = await this.workspaces.accountOf(job.workspaceId as WorkspaceId);
    if (!accountId) return;
    const text = MESSAGES[locale][type];
    const channels: NotifyInput['channels'] = this.notifications.emailAvailable()
      ? ['in_app', 'email']
      : ['in_app'];
    await this.notifications
      .notify({
        accountId,
        userId: job.requestedByUserId,
        workspaceId: job.workspaceId,
        type,
        params: { exportId: job.id },
        title: text.title,
        body: text.body(businessName),
        target: { kind: 'path', path: SETTINGS_DATA_PATH },
        channels,
        dedupKey: `${type}:${job.id}`,
      })
      .catch(() => this.#log.error(`export ${job.id}: notification failed`));
  }
}

const MESSAGES = {
  vi: {
    'dataexport.ready': {
      title: 'Dữ liệu xuất đã sẵn sàng',
      body: (name: string | null) =>
        `Bản xuất toàn bộ dữ liệu${name ? ` của ${name}` : ''} đã sẵn sàng. Tải về trong Cài đặt → Dữ liệu trong 7 ngày.`,
    },
    'dataexport.failed': {
      title: 'Xuất dữ liệu không thành công',
      body: () => 'Không tạo được bản xuất dữ liệu. Vui lòng thử lại trong Cài đặt → Dữ liệu.',
    },
  },
  en: {
    'dataexport.ready': {
      title: 'Your data export is ready',
      body: (name: string | null) =>
        `The export of all data${name ? ` of ${name}` : ''} is ready. Download it in Settings → Data within 7 days.`,
    },
    'dataexport.failed': {
      title: 'Data export failed',
      body: () => 'The data export could not be created. Please try again in Settings → Data.',
    },
  },
} as const;
