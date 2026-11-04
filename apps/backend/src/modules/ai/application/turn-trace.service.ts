import { PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type {
  BotTurnDetail,
  BotTurnList,
  BotTurnListQuery,
  BotTurnSummary,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import {
  KNOWLEDGE_FACADE,
  type KnowledgeFacade,
  TRAINING_FACADE,
  type TrainingFacade,
} from '../../knowledge/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { InvalidTurnCursorError, TurnNotFoundError } from '../domain/ai.errors.js';
import {
  TURN_TRACE_REPOSITORY,
  type TurnRow,
  type TurnStepRecord,
  type TurnTraceRepository,
} from '../domain/ports/turn-trace.repository.js';
import { activeSituations, situationsText } from '../domain/situations.js';
import { isProblemTurn, turnSignals, type TurnSignalContext } from '../domain/turn-signals.js';
import { loadReplyTemplate, promptRefsOf, renderBotSystemPrompt } from './reply-context.js';
import { sha256 } from './trace-recorder.js';

const DAY_MS = 86_400_000;
/** Traces are kept 30 days; older runs list with `hasTrace: false`. */
export const TRACE_RETENTION_DAYS = 30;
const DEFAULT_WINDOW_DAYS = 7;
/** `problemsOnly` is filtered after the signals: the repository over-fetches this factor. */
const PROBLEMS_OVERFETCH = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset cursor `createdAt|runId`, base64url. */
export function encodeTurnCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

export function decodeTurnCursor(cursor: string): { createdAt: Date; runId: string } {
  const [at, runId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(at ?? '');
  if (!runId || !UUID.test(runId) || Number.isNaN(createdAt.getTime()))
    throw new InvalidTurnCursorError();
  return { createdAt, runId };
}

/** Today's hashes of what a turn's trace recorded, per stored prompt version. */
interface CurrentHashes {
  systemPromptSha(promptVersion: string): Promise<string | null>;
  situationsSha: string | null;
}

/**
 * Reads shop-bot turn traces for GET /bots/{botId}/turns(/{runId}) (spec §5): `ai_runs` joined
 * with their 30-day traces, plus deterministic signals. Bot-scoped: another bot's or another
 * workspace's run is 404.
 */
@Injectable()
export class TurnTraceService {
  readonly #prompts = new PromptRegistry(PROMPTS_DIR);

  constructor(
    @Inject(TURN_TRACE_REPOSITORY) private readonly traces: TurnTraceRepository,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(KNOWLEDGE_FACADE) @Optional() private readonly knowledge?: KnowledgeFacade,
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
  ) {}

  async list(ws: WorkspaceId, botId: string, query: BotTurnListQuery): Promise<BotTurnList> {
    const bot = await this.#bot(ws, botId);
    const now = new Date();
    const floor = new Date(now.getTime() - TRACE_RETENTION_DAYS * DAY_MS);
    const wide = Boolean(query.conversationId || query.around);
    const defaultFrom = new Date(
      now.getTime() - (wide ? TRACE_RETENTION_DAYS : DEFAULT_WINDOW_DAYS) * DAY_MS,
    );
    const from = maxDate(query.from ? new Date(query.from) : defaultFrom, floor);
    const to = minDate(query.to ? new Date(query.to) : now, now);
    if (from > to) return { items: [], nextCursor: null };

    const around = query.around ? new Date(query.around) : undefined;
    const cursor = query.cursor && !around ? decodeTurnCursor(query.cursor) : undefined;
    const fetch = query.problemsOnly ? query.limit * PROBLEMS_OVERFETCH : query.limit + 1;
    const rows = await this.traces.list(ws, {
      botId,
      ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      from,
      to,
      ...(around ? { around } : {}),
      ...(query.q ? { q: query.q } : {}),
      includeTests: query.includeTests ?? false,
      limit: fetch,
      ...(cursor ? { cursor } : {}),
    });
    const traced = rows.filter((r) => r.trace).map((r) => r.run.id);
    const steps = await this.traces.signalSteps(ws, traced);
    const hashes = await this.#currentHashes(ws, bot);

    const items: BotTurnSummary[] = [];
    let last: TurnRow | undefined;
    let consumed = 0;
    for (const row of rows) {
      if (items.length === query.limit) break;
      consumed += 1;
      last = row;
      const ctx = await this.#context(bot, row, hashes);
      const signals = turnSignals({ ...row, steps: steps.get(row.run.id) ?? [] }, ctx);
      if (query.problemsOnly && !isProblemTurn(row, signals.filter(notInformational))) continue;
      items.push(summaryOf(row, signals));
    }
    // More rows exist when some fetched rows were not consumed, or the repository filled the fetch.
    const more = rows.length > consumed || rows.length === fetch;
    return { items, nextCursor: !around && more && last ? encodeTurnCursor(last.run) : null };
  }

  async get(ws: WorkspaceId, botId: string, runId: string): Promise<BotTurnDetail> {
    const bot = await this.#bot(ws, botId);
    if (!UUID.test(runId)) throw new TurnNotFoundError();
    const row = await this.traces.get(ws, botId, runId);
    if (!row) throw new TurnNotFoundError();
    const hashes = await this.#currentHashes(ws, bot);
    const ctx = await this.#context(bot, row, hashes);
    const signals = turnSignals(row, ctx);
    const [faqs, items] = await Promise.all([
      this.knowledge && row.run.retrieved.length ? this.knowledge.listFaqs(ws, botId) : [],
      this.training && row.trace?.scenarioIds.length ? this.training.list(ws, botId) : [],
    ]);
    const faqById = new Map(faqs.map((f) => [f.id, f]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const { run, trace } = row;
    return {
      ...summaryOf(row, signals),
      inputTokens: run.inputTokens,
      cachedTokens: run.cachedTokens,
      outputTokens: run.outputTokens,
      channel: trace?.channel ?? null,
      commentReply: trace?.commentReply ?? null,
      historyTurns: trace?.historyTurns ?? null,
      historySummarized: trace?.historySummarized ?? null,
      customerImages: trace?.customerImages ?? null,
      faqHits: run.retrieved.map((hit) => {
        const faq = faqById.get(hit.faqId);
        return {
          faqId: hit.faqId,
          question: faq ? faq.question.slice(0, 300) : null,
          score: hit.score,
          used: hit.used,
          exists: faq !== undefined,
        };
      }),
      scenarios: (trace?.scenarioIds ?? []).map((id) => {
        const item = itemById.get(id);
        return { id, title: item ? item.title.slice(0, 200) : null, exists: item !== undefined };
      }),
      offeredTools: trace?.offeredTools ?? [],
      actionIds: trace?.actionIds ?? [],
      focusProductIds: trace?.focusProductIds ?? [],
      pendingAction: trace?.pendingAction ?? null,
      modelCalls: trace?.modelCalls ?? null,
      loopOutcome: trace?.loopOutcome ?? null,
      instructionsChangedSince: ctx.instructionsChangedSince,
      trainingChangedSince: ctx.trainingChangedSince,
      steps: row.steps.map(stepOf),
    };
  }

  /** Throws the bot module's NOT_FOUND for another workspace's or a malformed bot id. */
  async #bot(ws: WorkspaceId, botId: string): Promise<BotView> {
    if (!UUID.test(botId)) throw new TurnNotFoundError();
    return this.bots.getBot(ws, botId);
  }

  async #currentHashes(ws: WorkspaceId, bot: BotView): Promise<CurrentHashes> {
    const workspace = await this.workspaces.getById(ws);
    const cache = new Map<string, Promise<string | null>>();
    const scenarios = this.training
      ? (await this.training.list(ws, bot.id)).filter((item) => item.kind === 'scenario')
      : null;
    return {
      situationsSha: scenarios ? sha256(situationsText(activeSituations(scenarios))) : null,
      systemPromptSha: (promptVersion) => {
        let hit = cache.get(promptVersion);
        if (!hit) {
          hit = this.#systemSha(bot, workspace, promptVersion);
          cache.set(promptVersion, hit);
        }
        return hit;
      },
    };
  }

  async #systemSha(
    bot: BotView,
    workspace: { name: string },
    promptVersion: string,
  ): Promise<string | null> {
    const refs = promptRefsOf(promptVersion);
    if (!refs) return null;
    try {
      return sha256(
        renderBotSystemPrompt(bot, workspace, await loadReplyTemplate(this.#prompts, refs)),
      );
    } catch {
      // The stored prompt version cannot be loaded or rendered any more: unknown.
      return null;
    }
  }

  async #context(bot: BotView, row: TurnRow, hashes: CurrentHashes): Promise<TurnSignalContext> {
    const trace = row.trace;
    if (!trace)
      return { botTier: bot.modelTier, instructionsChangedSince: null, trainingChangedSince: null };
    const system = await hashes.systemPromptSha(row.run.promptVersion);
    return {
      botTier: bot.modelTier,
      instructionsChangedSince: system === null ? null : system !== trace.systemPromptSha,
      trainingChangedSince:
        hashes.situationsSha === null ? null : hashes.situationsSha !== trace.situationsSha,
    };
  }
}

/** The "changed since" hints are informational: they never make a turn a problem on their own. */
const notInformational = (s: { code: string }) =>
  s.code !== 'instructions_changed_since' && s.code !== 'training_changed_since';

const maxDate = (a: Date, b: Date) => (a > b ? a : b);
const minDate = (a: Date, b: Date) => (a < b ? a : b);

function summaryOf(row: TurnRow, signals: BotTurnSummary['signals']): BotTurnSummary {
  const { run, trace } = row;
  return {
    runId: run.id,
    conversationId: run.conversationId,
    isTest: run.isTest,
    startedAt: trace ? trace.startedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
    outcome: run.outcome,
    guardrail: run.guardrail,
    tier: run.tier,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    latencyMs: run.latencyMs,
    queryExcerpt: trace?.queryExcerpt ?? null,
    replyExcerpt: trace?.replyExcerpt ?? null,
    hasTrace: trace !== null,
    signals,
  };
}

function stepOf(step: TurnStepRecord): BotTurnDetail['steps'][number] {
  return { ...step };
}
