import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  IntegrationUnavailableError,
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRetailerError,
  KiotVietUnavailableError,
} from '../domain/integration.errors.js';
import { CatalogImport } from './catalog-import.js';
import { CatalogWriter } from './catalog-writer.js';
import {
  type ConnectionRecord,
  INTEGRATION_STORE,
  type IntegrationStore,
  type JobRecord,
} from './ports/integration-store.js';
import {
  ConnectionGoneError,
  type ImportCursor,
  isImportCursor,
  JOB_LEASE_MS,
  LeaseLostError,
  type SyncContext,
} from './sync-context.js';
import { openCredentials } from './sync-credentials.js';

/**
 * Retry delays of a failing job, by failures recorded so far (`job.attempts`); past the last one the
 * job is dead-lettered.
 */
const RETRY_MINUTES = [1, 5, 30] as const;
/** A reconcile re-reads changes from slightly before the last one, against clock skew. */
const RECONCILE_OVERLAP_MS = 2 * 60_000;

/**
 * Runs one claimed job (spec §4.2, §5.3, §8): a full import, or a reconcile (incremental from
 * `lastReconcileAt − 2 min`, full on request or when there was none). Every job write is fenced by
 * the claim token: a lost lease stops the job at once. Logs codes and counts only (rule 07).
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(CatalogImport) private readonly importer: CatalogImport,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(CatalogWriter) private readonly writer: CatalogWriter,
  ) {}

  /** Never throws, except `IntegrationUnavailableError` (no database: the runner skips). */
  async runJob(job: JobRecord): Promise<void> {
    try {
      const connection = await this.store.connectionForSystem(job.connectionId);
      if (
        !connection ||
        connection.status === 'disconnected' ||
        connection.workspaceId !== job.workspaceId ||
        connection.lastError?.code === 'connect_failed' ||
        job.kind === 'webhook'
      ) {
        await this.store.completeJob(job.id, job.claimToken);
        return;
      }
      await this.sync(job, connection);
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) throw error;
      if (error instanceof LeaseLostError) return;
      if (error instanceof ConnectionGoneError) {
        await this.releaseAfterDisconnect(job);
        await this.store.completeJob(job.id, job.claimToken);
        return;
      }
      this.logger.warn(
        `Job ${job.id} (${job.kind}) attempt ${job.attempts + 1}: ${errorName(error)}`,
      );
      try {
        await this.failed(job, error);
      } catch (inner) {
        if (inner instanceof IntegrationUnavailableError) throw inner;
        // The lease expires and the job is claimed again.
        this.logger.warn(`Job ${job.id}: failure not recorded (${errorName(inner)})`);
      }
    }
  }

  private async sync(job: JobRecord, connection: ConnectionRecord): Promise<void> {
    const ws = job.workspaceId;
    const ctx: SyncContext = {
      job,
      ws,
      connection,
      creds: openCredentials(this.secrets, connection),
      live: async () => {
        const now = await this.store.connectionForSystem(connection.id);
        if (!now || now.status === 'disconnected') throw new ConnectionGoneError();
        return now;
      },
      checkpoint: async (cursor) => {
        const saved = await this.store.saveCursor(
          job.id,
          job.claimToken,
          { ...cursor },
          JOB_LEASE_MS,
        );
        if (!saved) throw new LeaseLostError();
      },
    };

    let cursor = isImportCursor(job.cursor) ? job.cursor : this.firstCursor(job, connection);
    if (!isImportCursor(job.cursor)) {
      if (cursor.mode === 'full') {
        await this.store.updateConnection(ws, connection.id, {
          status: 'syncing',
          progress: { phase: 'products', done: 0, total: null },
        });
      }
      await ctx.checkpoint(cursor);
    }

    const outcome = await this.importer.run(ctx, cursor);
    cursor = { ...cursor, imagesFailed: outcome.imagesFailed };
    const startedAt = new Date(cursor.startedAt);

    await ctx.live();
    await this.store.updateConnection(ws, connection.id, {
      status: 'connected',
      progress: null,
      lastError: null,
      counts: { ...connection.counts, products: outcome.products },
      lastReconcileAt: startedAt,
      ...(cursor.mode === 'full' ? { lastFullSyncAt: new Date() } : {}),
    });
    if (outcome.imagesFailed) {
      await this.store.log(ws, connection.id, {
        level: 'warning',
        code: 'image_failed',
        params: { count: outcome.imagesFailed },
      });
    }
    if (cursor.mode === 'full') {
      await this.store.log(ws, connection.id, {
        level: 'info',
        code: 'full_sync_done',
        params: { products: outcome.products, images_failed: outcome.imagesFailed },
      });
    }
    if (!(await this.store.completeJob(job.id, job.claimToken))) return;

    // The owner changed the sale branches while this ran: recompute stock with the new ones.
    const latest = await this.store.connectionForSystem(connection.id);
    if (latest && latest.status !== 'disconnected') {
      if (!sameIds(latest.settings.saleBranchIds, cursor.saleBranchIds)) {
        await this.store.enqueue(ws, {
          connectionId: connection.id,
          kind: 'reconcile',
          payload: { full: true },
        });
      }
    }
  }

  /**
   * The connection was disconnected while this job wrote: items written after the disconnect
   * released the links would stay linked (and locked), so release them again (spec §8).
   */
  private async releaseAfterDisconnect(job: JobRecord): Promise<void> {
    try {
      await this.writer.releaseIfDisconnected(job.workspaceId);
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) throw error;
      this.logger.warn(`Job ${job.id}: links not released after disconnect (${errorName(error)})`);
    }
  }

  private firstCursor(job: JobRecord, c: ConnectionRecord): ImportCursor {
    const last = c.lastReconcileAt;
    const full = job.kind === 'full_import' || job.payload['full'] === true || !last;
    const since = full ? null : new Date(last.getTime() - RECONCILE_OVERLAP_MS);
    return {
      mode: full ? 'full' : 'incremental',
      phase: 'products',
      currentItem: 0,
      saleBranchIds: [...c.settings.saleBranchIds],
      startedAt: new Date().toISOString(),
      since: since ? since.toISOString() : null,
      imagesFailed: 0,
      incomplete: false,
      seenProducts: [],
      seenVariants: [],
    };
  }

  /** Auth errors stop at once (the owner must update the code); others retry, then dead-letter. */
  private async failed(job: JobRecord, error: unknown): Promise<void> {
    const ws = job.workspaceId;
    const at = new Date().toISOString();
    const c = await this.store.connectionForSystem(job.connectionId);
    if (!c || c.status === 'disconnected') {
      await this.releaseAfterDisconnect(job);
      await this.store.completeJob(job.id, job.claimToken);
      return;
    }
    if (
      error instanceof KiotVietAuthError ||
      error instanceof KiotVietRetailerError ||
      error instanceof KiotVietPermissionError
    ) {
      if (!(await this.store.failJob(job.id, job.claimToken, 'auth_failed'))) return;
      // Reported already: periodic retries of a rejected code do not flood the log.
      const already = c.lastError?.code === 'auth_failed';
      await this.store.updateConnection(ws, c.id, {
        status: 'error',
        progress: null,
        lastError: { code: 'auth_failed', at },
      });
      if (!already) await this.store.log(ws, c.id, { level: 'error', code: 'auth_failed' });
      return;
    }

    const code = error instanceof KiotVietUnavailableError ? 'kiotviet_unavailable' : 'sync_failed';
    const delay = RETRY_MINUTES[job.attempts];
    if (delay !== undefined) {
      await this.store.retryJob(
        job.id,
        job.claimToken,
        new Date(Date.now() + delay * 60_000),
        code,
      );
      return;
    }
    if (!(await this.store.failJob(job.id, job.claimToken, code))) return;
    await this.store.updateConnection(ws, c.id, {
      status: 'error',
      progress: null,
      lastError: { code, at },
    });
    await this.store.log(ws, c.id, { level: 'error', code });
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';
