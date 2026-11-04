import {
  PROMPTS_DIR,
  PromptRegistry,
  scanUntrustedText,
  type GenerateResponse,
  type PromptRef,
} from '@agent-sales/ai-core';
import type { CreateImportBatchRequest, ImportBatchDto } from '@agent-sales/contracts';
import { isUuid, newId, workspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { AI_LLM_GATEWAY, isAiNotConfiguredError, type LlmGatewayPort } from '../../ai/api/index.js';
import {
  AssistantBusyError,
  AssistantImportInvalidError,
  AssistantNotFoundError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  IMPORT_BATCH_RETENTION_MS,
  type AssistantRepository,
  type ImportBatchRecord,
  type RecordedRun,
} from '../domain/ports/assistant.repository.js';
import {
  buildDrafts,
  draftsHash,
  type ImportPhotoGroup,
  type VisionDraft,
} from '../domain/product-import.js';
import { toImportBatchDto } from './import-block.js';

/** The photo-drafting prompt (`packages/ai-core/prompts/assistant-import-vision@1.md`). */
export const IMPORT_VISION_PROMPT = {
  name: 'assistant-import-vision',
  version: 1,
} as const satisfies PromptRef;
export const IMPORT_VISION_TIER = 'pro' as const;
/** Vision calls of one batch run at most this many at a time (C4-R4). */
export const IMPORT_VISION_CONCURRENCY = 4;
export const IMPORT_VISION_CALL_MS = 25_000;
/** Every vision call of one batch together. */
export const IMPORT_VISION_BATCH_MS = 55_000;
/** Thumbnails sent per vision call. */
export const IMPORT_VISION_MAX_IMAGES = 3;
/** The user message of a vision call; the photos are attached to it. */
export const IMPORT_VISION_USER_TEXT = 'Ảnh sản phẩm';

/** What the vision model is asked for (structured output); the reply is still parsed leniently. */
export const VisionDraftSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(1500),
  category: z.string().max(120).nullable(),
  attributes: z.array(z.object({ name: z.string().max(40), value: z.string().max(120) })).max(10),
});

/** The reply as models really send it: limits are cut, not refused. */
const LenientVision = z.object({
  name: z.string().catch(''),
  description: z.string().catch(''),
  category: z.string().nullable().optional().catch(null),
  attributes: z
    .array(z.object({ name: z.coerce.string(), value: z.coerce.string() }))
    .optional()
    .catch([]),
});

type SheetRequest = Extract<CreateImportBatchRequest, { kind: 'sheet' }>;
type PhotoRequest = Extract<CreateImportBatchRequest, { kind: 'photos' }>;

const registry = new PromptRegistry(PROMPTS_DIR);

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** Trailing empty rows and columns removed; a cell counts when it has non-space text. */
export function trimSheet(rows: string[][]): string[][] {
  const filled = (c: string | undefined) => (c ?? '').trim() !== '';
  let lastRow = rows.length - 1;
  while (lastRow >= 0 && !(rows[lastRow] ?? []).some(filled)) lastRow--;
  const kept = rows.slice(0, lastRow + 1);
  let width = 0;
  for (const row of kept) {
    for (let i = row.length - 1; i >= width; i--) {
      if (filled(row[i])) {
        width = i + 1;
        break;
      }
    }
  }
  return kept.map((row) => row.slice(0, width));
}

/** The JSON object in a model reply (a ```json fence is tolerated). */
export function parseVisionReply(text: string): VisionDraft | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = LenientVision.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  const category = v.category?.trim() ? v.category.trim().slice(0, 120) : null;
  return {
    name: v.name.trim().slice(0, 200),
    description: v.description.trim().slice(0, 1500),
    category,
    attributes: (v.attributes ?? [])
      .map((a) => ({ name: a.name.trim().slice(0, 40), value: a.value.trim().slice(0, 120) }))
      .filter((a) => a.name && a.value)
      .slice(0, 10),
  };
}

/**
 * The safety scan of a vision draft (spec §5.2): a text field flagged by `scanUntrustedText` is
 * dropped and recorded as `unsafe_text:<field>`, so text read from a photo never reaches the
 * catalog (and the shop bot) as an injection path.
 */
export function scanVision(v: VisionDraft): { vision: VisionDraft; warnings: string[] } {
  const warnings: string[] = [];
  const safe = (field: string, value: string): boolean => {
    if (!value || scanUntrustedText(value).ok) return true;
    if (!warnings.includes(`unsafe_text:${field}`)) warnings.push(`unsafe_text:${field}`);
    return false;
  };
  return {
    vision: {
      name: safe('name', v.name) ? v.name : '',
      description: safe('description', v.description) ? v.description : '',
      category: v.category !== null && safe('category', v.category) ? v.category : null,
      attributes: v.attributes.filter((a) => safe('attributes', `${a.name}: ${a.value}`)),
    },
    warnings,
  };
}

/** Runs `tasks` with at most `limit` at a time; results in input order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      if (task) out[i] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

interface VisionCall {
  group: ImportPhotoGroup;
  run: Omit<RecordedRun, 'id' | 'threadId' | 'kind' | 'tier' | 'promptVersion'>;
}

/**
 * Product import batches (T-173, spec §3, §6.1). A sheet arrives as rows the browser read; photos
 * arrive as already uploaded paths plus small thumbnails, drafted by a vision model here, under
 * the owner's turn lock (C4-R4). Thumbnails are never stored or logged.
 */
@Injectable()
export class ImportBatchService {
  readonly #log = new Logger(ImportBatchService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
  ) {}

  /** Tests replace the clock. */
  now: () => Date = () => new Date();

  async create(
    scope: OwnerScope,
    threadId: string,
    req: CreateImportBatchRequest,
  ): Promise<ImportBatchDto> {
    if (!isUuid(threadId) || !(await this.repo.getThread(scope, threadId))) {
      throw new AssistantNotFoundError('thread', threadId);
    }
    if (!scope.businessIds.some((b) => b === req.businessId)) {
      throw new AssistantNotFoundError('import batch', req.businessId);
    }
    await this.repo.purgeImportBatches(
      scope,
      new Date(this.now().getTime() - IMPORT_BATCH_RETENTION_MS),
    );
    const batch =
      req.kind === 'sheet'
        ? await this.#sheet(scope, threadId, req)
        : await this.#photos(scope, threadId, req);
    return toImportBatchDto(batch);
  }

  async get(scope: OwnerScope, batchId: string): Promise<ImportBatchDto> {
    return toImportBatchDto(await this.load(scope, batchId));
  }

  /** The owner's batch whose business is still in scope; 404 otherwise. */
  async load(scope: OwnerScope, batchId: string): Promise<ImportBatchRecord> {
    const batch = isUuid(batchId) ? await this.repo.getImportBatch(scope, batchId) : null;
    if (!batch || !scope.businessIds.some((b) => b === batch.businessId)) {
      throw new AssistantNotFoundError('import batch', batchId);
    }
    return batch;
  }

  async #sheet(scope: OwnerScope, threadId: string, req: SheetRequest): Promise<ImportBatchRecord> {
    const rows = trimSheet(req.rows);
    const rowCount = rows.filter((r) => r.some((c) => c.trim() !== '')).length;
    // A header alone has no data to import.
    if (rowCount < 2) throw new AssistantImportInvalidError('import_empty');
    return this.repo.createImportBatch(scope, {
      id: newId(),
      threadId,
      businessId: req.businessId,
      kind: 'sheet',
      fileName: req.fileName,
      status: 'ready',
      source: { kind: 'sheet', rows },
      rowCount,
    });
  }

  async #photos(
    scope: OwnerScope,
    threadId: string,
    req: PhotoRequest,
  ): Promise<ImportBatchRecord> {
    const own = new RegExp(
      `^/media/products/${req.businessId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpe?g|png)$`,
      'i',
    );
    if (!req.items.every((i) => own.test(i.imageUrl))) {
      throw new AssistantImportInvalidError('import_bad_image');
    }
    const groups = req.grouping === 'one_product' ? [req.items] : req.items.map((item) => [item]);
    // The first call's run row is the owner's turn lock: no chat turn runs while photos are read.
    const lockId = newId();
    const started = await this.repo.startRun(scope, {
      id: lockId,
      threadId,
      tier: IMPORT_VISION_TIER,
      promptVersion: `${IMPORT_VISION_PROMPT.name}@${IMPORT_VISION_PROMPT.version}`,
      kind: 'import_vision',
    });
    if (started !== 'started') throw new AssistantBusyError();

    let calls: VisionCall[];
    try {
      const system = await registry.load(IMPORT_VISION_PROMPT);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), IMPORT_VISION_BATCH_MS);
      try {
        calls = await pool(
          groups.map((items) => () => this.#draft(req.businessId, system, items, abort.signal)),
          IMPORT_VISION_CONCURRENCY,
        );
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      await this.repo
        .finishRun(scope, lockId, { status: 'failed', finishedAt: new Date() })
        .catch(() => undefined);
      throw error;
    }
    await this.#recordRuns(scope, threadId, lockId, calls);

    const source = {
      kind: 'photos' as const,
      grouping: req.grouping,
      groups: calls.map((c) => c.group),
    };
    const batch = await this.repo.createImportBatch(scope, {
      id: newId(),
      threadId,
      businessId: req.businessId,
      kind: 'photos',
      fileName: `${req.items.length} ảnh`,
      status: 'ready',
      source,
      rowCount: groups.length,
    });
    // Photo drafts need no mapping: the card shows them at once.
    const drafts = buildDrafts({
      source,
      spec: null,
      overrides: {},
      excluded: [],
      existing: null,
      createdKeys: new Set(),
    });
    const preview = {
      spec: null,
      overrides: {},
      excluded: [],
      drafts,
      draftsHash: draftsHash(drafts),
    };
    await this.repo.saveImportPreview(scope, batch.id, preview);
    this.#log.log(
      `assistant import ${batch.id}: photos=${req.items.length} groups=${groups.length} failed=${
        calls.filter((c) => c.group.visionError).length
      }`,
    );
    return { ...batch, ...preview };
  }

  /** One vision call for one product group; never throws. */
  async #draft(
    businessId: string,
    system: string,
    items: PhotoRequest['items'],
    signal: AbortSignal,
  ): Promise<VisionCall> {
    const imageUrls = items.map((i) => i.imageUrl);
    const started = Date.now();
    let res: GenerateResponse | undefined;
    try {
      res = await this.gateway.generate({
        workspaceId: workspaceId(businessId),
        tier: IMPORT_VISION_TIER,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: IMPORT_VISION_USER_TEXT },
        ],
        images: items
          .slice(0, IMPORT_VISION_MAX_IMAGES)
          .map((i) => ({ mimeType: i.mimeType, base64: i.base64 })),
        responseFormat: VisionDraftSchema,
        timeoutMs: IMPORT_VISION_CALL_MS,
        signal,
      });
    } catch (error) {
      const code = isAiNotConfiguredError(error) ? 'ai_unavailable' : 'vision_failed';
      this.#log.warn(`assistant import vision call failed (${errorClass(error)})`);
      return {
        group: { imageUrls, vision: null, visionError: code },
        run: this.#run('failed', code, Date.now() - started),
      };
    }
    const parsed = parseVisionReply(res.text);
    const usage = {
      provider: res.provider,
      model: res.model,
      inputTokens: res.usage.inputTokens,
      cachedTokens: res.usage.cachedInputTokens,
      outputTokens: res.usage.outputTokens,
    };
    if (!parsed) {
      return {
        group: { imageUrls, vision: null, visionError: 'vision_failed' },
        run: { ...this.#run('failed', 'bad_output', Date.now() - started), ...usage },
      };
    }
    const { vision, warnings } = scanVision(parsed);
    return {
      group: {
        imageUrls,
        vision,
        visionError: null,
        ...(warnings.length ? { visionWarnings: warnings } : {}),
      },
      run: { ...this.#run('done', 'done', Date.now() - started), ...usage },
    };
  }

  #run(status: 'done' | 'failed', outcome: string, ms: number): VisionCall['run'] {
    return {
      status,
      outcome,
      provider: null,
      model: null,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      latencyMs: Math.round(ms),
      rounds: 1,
      guardrail: null,
    };
  }

  /** One `import_vision` run per call (tokens, model, outcome; never text). Best effort. */
  async #recordRuns(
    scope: OwnerScope,
    threadId: string,
    lockId: string,
    calls: VisionCall[],
  ): Promise<void> {
    const promptVersion = `${IMPORT_VISION_PROMPT.name}@${IMPORT_VISION_PROMPT.version}`;
    await Promise.all(
      calls.map(async (c, i) => {
        const id = i === 0 ? lockId : newId();
        try {
          if (i === 0) {
            await this.repo.finishRun(scope, id, { ...c.run, finishedAt: new Date() });
          } else {
            await this.repo.recordRun(scope, {
              ...c.run,
              id,
              threadId,
              kind: 'import_vision',
              tier: IMPORT_VISION_TIER,
              promptVersion,
            });
          }
        } catch (e) {
          this.#log.warn(`assistant run ${id}: import vision run not saved (${errorClass(e)})`);
        }
      }),
    );
  }
}
