import type {
  AutonomyAction,
  AutonomyLevel,
  AutonomySettingsResponse,
  BrainSettingsDto,
  BrainUsageDto,
  ConversationSignalDto,
  EvaluateSignalsStatus,
  SignalTrigger,
  UpdateAutonomySettingsRequest,
  UpdateConversationSignalRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { BrainFacade } from '../api/brain.facade.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import {
  SignalConversationNotFoundError,
  SignalEvaluationFailedError,
} from '../domain/brain.errors.js';
import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';
import { type ConversationSignal, stageChange } from '../domain/signal.js';
import { AutonomyService } from './autonomy.service.js';
import { SettingsService } from './settings.service.js';
import { SignalEvaluator } from './signal-evaluator.js';
import { UsageService } from './usage.service.js';

/** Signals asked for at once (Today's queues), at most. */
export const MAX_SIGNALS_PER_READ = 500;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const EPOCH = new Date(0);

export function toSignalDto(s: ConversationSignal): ConversationSignalDto {
  return {
    conversationId: s.conversationId,
    contactId: s.contactId,
    stage: s.stage,
    intent: s.intent,
    mood: s.mood,
    needsHuman: s.needsHuman,
    needsHumanReason: s.needsHumanReason,
    followUpAt: iso(s.followUpAt),
    followUpReason: s.followUpReason,
    note: s.note,
    evaluatedUntil: iso(s.evaluatedUntil),
    evaluatedAt: iso(s.evaluatedAt),
    stageLocked: s.stageLocked,
    dismissedUntilMessageAfter: iso(s.dismissedUntilMessageAfter),
    optOut: s.optOut,
    version: s.version,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** The brain module's use cases, for its controllers and for other modules (Today, Task 4). */
@Injectable()
export class BrainFacadeImpl implements BrainFacade {
  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(SignalEvaluator) private readonly evaluator: SignalEvaluator,
    @Inject(UsageService) private readonly usageService: UsageService,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
    @Inject(AutonomyService) private readonly autonomyService: AutonomyService,
  ) {}

  async signalsFor(
    ws: WorkspaceId,
    conversationIds: readonly string[],
  ): Promise<ConversationSignalDto[]> {
    if (!conversationIds.length) return [];
    const ids = [...new Set(conversationIds)].slice(0, MAX_SIGNALS_PER_READ);
    return (await this.store.signalsFor(ws, ids)).map(toSignalDto);
  }

  /** One conversation's signals; NOT_FOUND when the conversation is not in this workspace. */
  async signalOf(ws: WorkspaceId, conversationId: string): Promise<ConversationSignalDto | null> {
    await this.#assertConversation(ws, conversationId);
    const s = await this.store.getSignal(ws, conversationId);
    return s ? toSignalDto(s) : null;
  }

  async evaluateNow(
    ws: WorkspaceId,
    conversationId: string,
    trigger: Exclude<SignalTrigger, 'idle'>,
  ): Promise<{ status: EvaluateSignalsStatus; signal: ConversationSignalDto | null }> {
    const r = await this.evaluator.evaluate(ws, conversationId, trigger);
    if (r.status === 'failed') throw new SignalEvaluationFailedError(r.reason);
    // Only the idle trigger skips; a manual request is never skipped.
    if (r.status === 'skipped') return { status: 'nothing_new', signal: null };
    return { status: r.status, signal: r.signal ? toSignalDto(r.signal) : null };
  }

  /** A member sets the stage by hand (locked) or unlocks it. */
  async updateSignal(
    ws: WorkspaceId,
    conversationId: string,
    change: UpdateConversationSignalRequest,
    now = new Date(),
  ): Promise<ConversationSignalDto> {
    const contactId = await this.#assertConversation(ws, conversationId);
    // Only the stage and its lock are written: an evaluation running meanwhile keeps its answer
    // and this change (the store's write rules).
    const next = await this.store.saveStage(
      ws,
      conversationId,
      contactId,
      stageChange(change),
      now,
    );
    return toSignalDto(next);
  }

  usage(ws: WorkspaceId): Promise<BrainUsageDto> {
    return this.usageService.usage(ws);
  }

  levelFor(ws: WorkspaceId, action: AutonomyAction): Promise<AutonomyLevel> {
    return this.autonomyService.levelFor(ws, action);
  }

  autonomy(ws: WorkspaceId): Promise<AutonomySettingsResponse> {
    return this.autonomyService.list(ws);
  }

  putAutonomy(
    ws: WorkspaceId,
    input: UpdateAutonomySettingsRequest,
    actorId: string,
  ): Promise<AutonomySettingsResponse> {
    return this.autonomyService.put(ws, input, actorId);
  }

  settings(ws: WorkspaceId): Promise<BrainSettingsDto> {
    return this.settingsService.get(ws);
  }

  putSettings(ws: WorkspaceId, input: BrainSettingsDto): Promise<BrainSettingsDto> {
    return this.settingsService.put(ws, input);
  }

  /**
   * The conversation's customer id; NOT_FOUND when it is not in this workspace. Reads the
   * conversation row only (`todayCandidates` by id, spam included), not its messages.
   */
  async #assertConversation(ws: WorkspaceId, conversationId: string): Promise<string | null> {
    const [f] = await this.conversations.todayCandidates(ws, {
      ids: [conversationId],
      awaitingBefore: EPOCH,
      followUpBefore: EPOCH,
      limit: 1,
    });
    if (!f || f.id !== conversationId) throw new SignalConversationNotFoundError(conversationId);
    return f.contactId;
  }
}
