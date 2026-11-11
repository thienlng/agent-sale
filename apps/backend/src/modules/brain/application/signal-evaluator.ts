import { PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type { SignalTrigger } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AI_FACADE,
  AI_LLM_GATEWAY,
  type AiFacade,
  isAiNotConfiguredError,
  type LlmGatewayPort,
} from '../../ai/api/index.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
  type SignalContext,
} from '../../conversation/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { SignalConversationNotFoundError } from '../domain/brain.errors.js';
import {
  buildEvaluationInput,
  EVALUATION_MAX_OUTPUT_TOKENS,
  EVALUATION_PROMPT,
  EVALUATION_TIER,
  EVALUATION_TIMEOUT_MS,
  EvaluationWireSchema,
  type EvaluationOutput,
  parseEvaluationOutput,
} from '../domain/evaluation-prompt.js';
import { BRAIN_STORE, type BrainStore, type SignalRunRecord } from '../domain/ports/brain.store.js';
import { type SkipReason, shouldSkip } from '../domain/schedule.js';
import {
  applyEvaluation,
  becameComplaint,
  blankSignal,
  type ConversationSignal,
} from '../domain/signal.js';
import { ComplaintAlert } from './complaint-alert.js';
import { SettingsService } from './settings.service.js';
import { UsageService } from './usage.service.js';

/** One retry on an unusable answer (spec §3.3). */
const MAX_CALLS = 2;

export type EvaluationResult =
  | { status: 'ok'; signal: ConversationSignal }
  | { status: 'capped' | 'nothing_new' | 'disabled'; signal: ConversationSignal | null }
  /** Idle trigger only: the job is dropped without a call (brief rule 2). */
  | { status: 'skipped'; reason: SkipReason }
  /** The model failed or answered twice with something unusable: nothing was written. */
  | { status: 'failed'; reason: 'invalid' | 'error' | 'timeout' };

const registry = new PromptRegistry(PROMPTS_DIR);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const isTimeout = (e: unknown): boolean =>
  e instanceof Error &&
  (e.name === 'TimeoutError' || (e as Error & { kind?: unknown }).kind === 'timeout');

/**
 * One evaluation of one conversation (spec §3.3): the previous note (or the stored summary on the
 * first run) + the messages after `evaluated_until` + one fact line → one tier-`basic` call with
 * a JSON answer, retried once when unusable. The day's evaluation is reserved before the call and
 * given back when the call fails; every call writes one `signal_runs` row.
 */
@Injectable()
export class SignalEvaluator {
  readonly #log = new Logger(SignalEvaluator.name);

  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(AI_FACADE) private readonly ai: AiFacade,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ComplaintAlert) private readonly alert: ComplaintAlert,
  ) {}

  async evaluate(
    ws: WorkspaceId,
    conversationId: string,
    trigger: SignalTrigger,
    now = new Date(),
  ): Promise<EvaluationResult> {
    const prev = await this.store.getSignal(ws, conversationId);
    const ctx = await this.conversations.signalContext(
      ws,
      conversationId,
      prev?.evaluatedUntil ?? null,
    );
    if (!ctx) throw new SignalConversationNotFoundError(conversationId);
    const customerAts = ctx.messages.filter((m) => m.sender === 'customer').map((m) => m.at);
    const hasNew = customerAts.length > 0;
    if (trigger === 'idle') {
      const { mode } = await this.settings.get(ws);
      const reason = shouldSkip({
        mode,
        isTest: ctx.facts.isTest,
        status: ctx.facts.status,
        hasNewCustomerMessage: hasNew,
      });
      if (reason) return { status: 'skipped', reason };
    } else {
      if (ctx.facts.isTest || ctx.facts.status === 'spam')
        return { status: 'disabled', signal: prev };
      if (!hasNew) return { status: 'nothing_new', signal: prev };
    }
    const reservation = await this.usage.reserve(ws, now);
    if (!reservation) return { status: 'capped', signal: prev };

    let answer: EvaluationOutput;
    try {
      const outcome = await this.#call(ws, conversationId, trigger, prev, ctx, now);
      if (outcome.status !== 'ok') {
        // An unusable answer still cost a call: only a failed call gives the evaluation back.
        if (outcome.status !== 'invalid') await this.usage.release(ws, reservation);
        if (outcome.status === 'disabled') return { status: 'disabled', signal: prev };
        return { status: 'failed', reason: outcome.status };
      }
      answer = outcome.answer;
    } catch (e) {
      await this.usage.release(ws, reservation);
      throw e;
    }

    const base = prev ?? blankSignal(conversationId, ctx.facts.contactId, now);
    const last = ctx.messages[ctx.messages.length - 1];
    const lastCustomer = customerAts[customerAts.length - 1];
    const next = applyEvaluation(
      base,
      answer,
      {
        lastMessageAt: new Date(last?.at ?? now),
        lastCustomerMessageAt: lastCustomer ? new Date(lastCustomer) : null,
        contactId: ctx.facts.contactId,
      },
      now,
    );
    await this.store.saveSignal(ws, next);
    if (becameComplaint(base, next)) {
      await this.alert.raise(
        ws,
        {
          conversationId,
          customerName: ctx.facts.customerName,
          assigneeId: ctx.facts.assigneeId,
          reason: next.needsHumanReason ?? next.intent,
        },
        now,
      );
    }
    return { status: 'ok', signal: next };
  }

  async #call(
    ws: WorkspaceId,
    conversationId: string,
    trigger: SignalTrigger,
    prev: ConversationSignal | null,
    ctx: SignalContext,
    now: Date,
  ): Promise<
    | { status: 'ok'; answer: EvaluationOutput }
    | { status: 'invalid' | 'error' | 'timeout' | 'disabled' }
  > {
    const summary = prev?.note ? null : await this.ai.conversationSummary(ws, conversationId);
    const contact = await this.#contact(ws, ctx.facts.contactId);
    const user = buildEvaluationInput({
      previousNote: prev?.note ?? null,
      summary: summary?.summary ?? null,
      messages: ctx.messages,
      facts: {
        hasCustomerRecord: contact !== null,
        phoneKnown: Boolean(contact?.phone),
        status: ctx.facts.status,
        lastMessageSender: ctx.facts.lastMessageSender,
        awaitingSince: ctx.facts.awaitingSince,
        stage: prev?.stage ?? 'new',
        stageLocked: prev?.stageLocked ?? false,
      },
      now,
    });
    const system = await registry.load(EVALUATION_PROMPT);
    const run = (r: Omit<SignalRunRecord, 'conversationId' | 'trigger' | 'tier'>) =>
      this.store
        .recordRun(ws, { conversationId, trigger, tier: EVALUATION_TIER, ...r })
        .catch((e: unknown) => {
          this.#log.warn(`signal run of ${conversationId} not saved (${errorClass(e)})`);
        });
    for (let attempt = 1; attempt <= MAX_CALLS; attempt++) {
      let res;
      try {
        res = await this.gateway.generate({
          workspaceId: ws,
          tier: EVALUATION_TIER,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          responseFormat: EvaluationWireSchema,
          maxOutputTokens: EVALUATION_MAX_OUTPUT_TOKENS,
          timeoutMs: EVALUATION_TIMEOUT_MS,
          signal: AbortSignal.timeout(EVALUATION_TIMEOUT_MS),
        });
      } catch (e) {
        if (isAiNotConfiguredError(e)) return { status: 'disabled' };
        const outcome = isTimeout(e) ? 'timeout' : 'error';
        await run({ model: null, inputTokens: 0, outputTokens: 0, outcome });
        this.#log.warn(`evaluation of ${conversationId} failed (${errorClass(e)})`);
        return { status: outcome };
      }
      const answer = parseEvaluationOutput(res.text, now);
      await run({
        model: res.model.slice(0, 120) || null,
        inputTokens: res.usage.inputTokens + res.usage.cachedInputTokens,
        outputTokens: res.usage.outputTokens,
        outcome: answer ? 'ok' : 'invalid',
      });
      if (answer) return { status: 'ok', answer };
    }
    return { status: 'invalid' };
  }

  /** The linked CRM customer, or null (none linked, or deleted meanwhile). */
  async #contact(ws: WorkspaceId, contactId: string | null) {
    if (!contactId) return null;
    try {
      return await this.crm.getContact(ws, contactId);
    } catch {
      return null;
    }
  }
}
