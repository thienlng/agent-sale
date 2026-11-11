import type { CareTemplateDto, ConversationSignalDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { BRAIN_FACADE, type BrainFacade } from '../../brain/api/index.js';
import { COMMERCE_FACADE, type CommerceFacade } from '../../commerce/api/index.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
  type FollowUpFacts,
} from '../../conversation/api/index.js';
import { LODGING_FACADE, type LodgingFacade } from '../../lodging/api/index.js';
import {
  type MessageTemplate,
  type StopReason,
  stopReason,
  windowClosesAt,
} from '../domain/care.js';
import { CareSettingsService } from './care-settings.service.js';

/** What the stop rules read, and their verdict. */
export interface GuardResult {
  /** Why nothing may be sent now; null: the follow-up still applies. */
  reason: StopReason | null;
  facts: FollowUpFacts | null;
  signal: ConversationSignalDto | null;
  template: CareTemplateDto;
  /** When the conversation's window closes (null: not a Meta channel or never written). */
  closes: Date | null;
}

/**
 * The stop rules of a follow-up (spec §3), read fresh: before every step (worker), before a
 * person's approval is claimed, and before a scheduled approved message goes out — so a lost
 * outbox event never turns into a wrong send. The conversation module checks the customer and
 * the mode once more in the transaction that reserves the message.
 */
@Injectable()
export class CareGuard {
  constructor(
    @Inject(CareSettingsService) private readonly settings: CareSettingsService,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BRAIN_FACADE) private readonly brain: BrainFacade,
    @Inject(COMMERCE_FACADE) @Optional() private readonly commerce?: CommerceFacade,
    @Inject(LODGING_FACADE) @Optional() private readonly lodging?: LodgingFacade,
  ) {}

  async check(
    ws: WorkspaceId,
    q: { conversationId: string; template: MessageTemplate; anchorAt: Date },
  ): Promise<GuardResult> {
    const [templates, facts, signals, lastOrderAt] = await Promise.all([
      this.settings.templates(ws),
      this.conversations.followUpFacts(ws, q.conversationId),
      this.brain.signalsFor(ws, [q.conversationId]),
      this.#lastOrderAt(ws, q.conversationId),
    ]);
    const template = templates[q.template];
    const signal = signals[0] ?? null;
    if (!facts) return { reason: 'closed', facts, signal, template, closes: null };
    const reason = stopReason({
      template: q.template,
      templateEnabled: template.enabled,
      anchorAt: q.anchorAt,
      facts,
      signal: signal ? { stage: signal.stage, optOut: signal.optOut } : null,
      lastOrderAt,
    });
    const closes = windowClosesAt(facts.provider, facts.lastInboundAt);
    return {
      reason: reason ?? (closes ? null : 'unsupported_channel'),
      facts,
      signal,
      template,
      closes,
    };
  }

  /** The newest order or stay booking of the conversation (a failed read: none). */
  async #lastOrderAt(ws: WorkspaceId, conv: string): Promise<Date | null> {
    const read = (p: Promise<{ at: Date }[]> | undefined) =>
      (p ?? Promise.resolve([])).catch(() => [] as { at: Date }[]);
    const times = (
      await Promise.all([
        read(this.commerce?.latestOrderTimes(ws, [conv])),
        read(this.lodging?.latestBookingTimes(ws, [conv])),
      ])
    ).flat();
    return times.length ? new Date(Math.max(...times.map((t) => t.at.getTime()))) : null;
  }
}
