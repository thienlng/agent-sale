import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BRAIN_FACADE, type BrainFacade } from '../../brain/api/index.js';
import { COMMERCE_FACADE, type CommerceFacade } from '../../commerce/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import { LODGING_FACADE, type LodgingFacade } from '../../lodging/api/index.js';
import {
  CARE_MAX_ATTEMPTS,
  CARE_RETRY_MS,
  inQuietHours,
  nextAllowedAfterLimit,
  nextHcmMidnight,
  placeInWindow,
  stepDue,
  stopReason,
  windowClosesAt,
} from '../domain/care.js';
import { CARE_STORE, type CareJob, type CareStore } from '../domain/ports/care.store.js';
import { CareSender } from './care-sender.js';
import { CareSettingsService } from './care-settings.service.js';
import { CareWriter } from './care-writer.service.js';

const DAY_MS = 86_400_000;
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** What one due step did. */
export type StepOutcome =
  'drafted' | 'sent' | 'send_failed' | 'skipped' | 'stopped' | 'rescheduled' | 'retry';

/**
 * Runs one due step of a follow-up cycle (spec §3–§5), in order: the stop rules (template off,
 * closed, opt-out, the customer replied, an order or booking, the stage moved, a person wrote or
 * took over, nobody answered the customer); the window (Messenger/Instagram, 24 hours, never a
 * message tag; outside it the AI does nothing); the quiet hours (to 08:00 if still inside the
 * window); ≤ 2 agent messages per conversation in 24 hours; the daily cap. Then one model call
 * writes the message or skips, and the autonomy level decides: `suggest` → a draft on Today
 * ("Chờ duyệt") that expires with the window; `act_and_report` / `auto` → sent now as a care
 * bot message. Then the cycle moves to its next step (placed in the window) or ends.
 */
@Injectable()
export class CareStep {
  readonly #log = new Logger(CareStep.name);

  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CareSettingsService) private readonly settings: CareSettingsService,
    @Inject(CareWriter) private readonly writer: CareWriter,
    @Inject(CareSender) private readonly sender: CareSender,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BRAIN_FACADE) private readonly brain: BrainFacade,
    @Inject(COMMERCE_FACADE) @Optional() private readonly commerce?: CommerceFacade,
    @Inject(LODGING_FACADE) @Optional() private readonly lodging?: LodgingFacade,
  ) {}

  async run(job: CareJob, now: Date): Promise<StepOutcome> {
    const ws = job.workspaceId;
    const conv = job.conversationId;
    const [templates, facts, signals, lastOrderAt] = await Promise.all([
      this.settings.templates(ws),
      this.conversations.followUpFacts(ws, conv),
      this.brain.signalsFor(ws, [conv]),
      this.#lastOrderAt(ws, conv),
    ]);
    const stop = async (reason: Parameters<CareStore['stop']>[2]) => {
      await this.store.stop(ws, job.id, reason, now);
      return 'stopped' as const;
    };
    if (!facts) return stop('closed');
    const signal = signals[0] ?? null;
    const template = templates[job.template];
    const reason = stopReason({
      template: job.template,
      templateEnabled: template.enabled,
      anchorAt: job.anchorAt,
      facts,
      signal: signal ? { stage: signal.stage, optOut: signal.optOut } : null,
      lastOrderAt,
    });
    if (reason) return stop(reason);
    const closes = windowClosesAt(facts.provider, facts.lastInboundAt);
    if (!closes) return stop('unsupported_channel');

    // Quiet hours, then the per-conversation limit: both only move the step inside the window.
    const later = async (at: Date, resetAttempts = true) => {
      const placed = placeInWindow(at, closes);
      if (!placed) return stop('window_closed');
      await this.store.reschedule(ws, job.id, placed, resetAttempts);
      return 'rescheduled' as const;
    };
    if (inQuietHours(now)) return later(now);
    if (!placeInWindow(now, closes)) return stop('window_closed');
    const sentAts = await this.store.sentTimes(ws, conv, new Date(now.getTime() - DAY_MS));
    const allowedAt = nextAllowedAfterLimit(sentAts, now);
    if (allowedAt) return later(allowedAt);

    const reservation = await this.settings.reserve(ws, now);
    if (!reservation) {
      const placed = placeInWindow(nextHcmMidnight(now), closes);
      if (!placed) return stop('capped');
      await this.store.reschedule(ws, job.id, placed, true);
      return 'rescheduled';
    }
    let written;
    try {
      written = await this.writer.write(ws, {
        conversationId: conv,
        template: job.template,
        step: job.step,
        instruction: template.instruction,
        note: signal?.note ?? null,
      });
    } catch (e) {
      written = { kind: 'failed' as const };
      this.#log.warn(`care step of ${conv} not written (${errorClass(e)})`);
    }
    if (written.kind === 'failed' || written.kind === 'disabled') {
      await this.settings.release(ws, reservation);
      if (written.kind === 'disabled' || job.attempts >= CARE_MAX_ATTEMPTS)
        return stop('ai_failed');
      return (await later(new Date(now.getTime() + CARE_RETRY_MS), false)) === 'stopped'
        ? 'stopped'
        : 'retry';
    }

    const level = await this.brain.levelFor(ws, 'care.send_message');
    const id = newId();
    const base = {
      id,
      conversationId: conv,
      enrollmentId: job.id,
      template: job.template,
      step: job.step,
      level,
      windowClosesAt: closes,
      model: written.model,
      inputTokens: written.inputTokens,
      outputTokens: written.outputTokens,
      createdAt: now,
    };
    let outcome: StepOutcome;
    if (written.kind === 'skip') {
      await this.store.insertMessage(ws, {
        ...base,
        text: '',
        status: 'skipped',
        skipReason: written.reason,
      });
      outcome = 'skipped';
    } else if (level === 'suggest') {
      await this.store.insertMessage(ws, {
        ...base,
        text: written.text,
        status: 'draft',
        skipReason: null,
      });
      outcome = 'drafted';
    } else {
      await this.store.insertMessage(ws, {
        ...base,
        text: written.text,
        status: 'sending',
        skipReason: null,
      });
      const sent = await this.sender.send(
        ws,
        { id, conversationId: conv, text: written.text },
        null,
        now,
      );
      if (sent.status !== 'sent') {
        // A closed conversation or window ends the cycle; a channel failure moves on.
        if (sent.reason === 'conversation_changed') return stop('window_closed');
        outcome = 'send_failed';
      } else outcome = 'sent';
    }
    await this.#next(ws, job, closes, now);
    return outcome;
  }

  /** The cycle's next step, placed in the window; or its end. */
  async #next(ws: WorkspaceId, job: CareJob, closes: Date, now: Date): Promise<void> {
    const due = stepDue(job.template, job.step + 1, job.anchorAt);
    const at = due ? placeInWindow(due, closes) : null;
    if (!at) {
      await this.store.finish(ws, job.id, now);
      return;
    }
    await this.store.advance(ws, job.id, job.step + 1, at, now);
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
