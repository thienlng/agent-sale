import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { BRAIN_FACADE, type BrainFacade } from '../../brain/api/index.js';
import {
  CARE_MAX_ATTEMPTS,
  CARE_RETRY_MS,
  inQuietHours,
  nextAllowedAfterLimit,
  nextHcmMidnight,
  placeInWindow,
  type StopReason,
  stepDue,
} from '../domain/care.js';
import { CARE_STORE, type CareJob, type CareStore } from '../domain/ports/care.store.js';
import { CareGuard } from './care-guard.js';
import { CareSender, type SendOutcome } from './care-sender.js';
import { CareSettingsService } from './care-settings.service.js';
import { CareWriter } from './care-writer.service.js';

const DAY_MS = 86_400_000;
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** What one due step did. */
export type StepOutcome =
  | 'drafted'
  | 'sent'
  | 'send_failed'
  | 'skipped'
  | 'stopped'
  | 'rescheduled'
  | 'retry'
  /** The step already has a message (a crashed or doubled run): nothing written or sent. */
  | 'repeated';

/** Why a send the conversation refused ends the cycle. */
const STOP_ON_REFUSAL: Record<
  Extract<SendOutcome, { status: 'failed' }>['reason'],
  StopReason | null
> = {
  customer_replied: 'customer_replied',
  taken_over: 'taken_over',
  conversation_closed: 'closed',
  window_closed: 'window_closed',
  channel_failed: null,
};

/**
 * Runs one due step of a follow-up cycle (spec §3–§5), in order: the stop rules (template off,
 * closed, opt-out, the customer replied, an order or booking, the stage moved, a person wrote or
 * took over, nobody answered the customer); the window (Messenger/Instagram, 24 hours, never a
 * message tag; outside it the AI does nothing); the quiet hours (to 08:00 if still inside the
 * window); ≤ 2 agent messages per conversation in 24 hours; the daily cap. Then one model call
 * writes the message or skips, and the autonomy level decides: `suggest` → a draft on Today
 * ("Chờ duyệt") that expires with the window; `act_and_report` / `auto` → sent now as a care
 * bot message. Then the cycle moves to its next step (placed in the window) or ends.
 *
 * A step is written and sent once: its message is keyed by (enrollment, anchor, step), checked
 * before the model call and enforced by a unique index, and its send uses the same key. The
 * daily reservation is given back whenever no message came of it (the model failed, the send
 * was refused or failed, or the step threw).
 */
@Injectable()
export class CareStep {
  readonly #log = new Logger(CareStep.name);

  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CareSettingsService) private readonly settings: CareSettingsService,
    @Inject(CareWriter) private readonly writer: CareWriter,
    @Inject(CareSender) private readonly sender: CareSender,
    @Inject(CareGuard) private readonly guard: CareGuard,
    @Inject(BRAIN_FACADE) private readonly brain: BrainFacade,
  ) {}

  async run(job: CareJob, now: Date): Promise<StepOutcome> {
    const ws = job.workspaceId;
    const conv = job.conversationId;
    const stop = async (reason: StopReason) => {
      await this.store.stop(ws, job, reason, now);
      return 'stopped' as const;
    };
    const g = await this.guard.check(ws, {
      conversationId: conv,
      template: job.template,
      anchorAt: job.anchorAt,
    });
    if (g.reason) return stop(g.reason);
    const closes = g.closes;
    if (!closes) return stop('unsupported_channel');
    // Written already by an earlier run of this step (it crashed, or its lease ran out while it
    // was still working): never write or send it again.
    if (await this.store.stepMessage(ws, job.id, job.anchorAt, job.step)) {
      await this.#next(ws, job, closes, now);
      return 'repeated';
    }

    // Quiet hours, then the per-conversation limit: both only move the step inside the window.
    const later = async (at: Date, resetAttempts = true) => {
      const placed = placeInWindow(at, closes);
      if (!placed) return stop('window_closed');
      await this.store.reschedule(ws, job, placed, resetAttempts);
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
      await this.store.reschedule(ws, job, placed, true);
      return 'rescheduled';
    }
    // The reservation is kept only when a message came of it (a draft, a send, a skip).
    let keep = false;
    try {
      let written;
      try {
        written = await this.writer.write(ws, {
          conversationId: conv,
          template: job.template,
          step: job.step,
          instruction: g.template.instruction,
          note: g.signal?.note ?? null,
        });
      } catch (e) {
        written = { kind: 'failed' as const };
        this.#log.warn(`care step of ${conv} not written (${errorClass(e)})`);
      }
      if (written.kind === 'failed' || written.kind === 'disabled') {
        if (written.kind === 'disabled' || job.attempts >= CARE_MAX_ATTEMPTS)
          return await stop('ai_failed');
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
        anchorAt: job.anchorAt,
        template: job.template,
        step: job.step,
        level,
        windowClosesAt: closes,
        model: written.model,
        inputTokens: written.inputTokens,
        outputTokens: written.outputTokens,
        createdAt: now,
      };
      const row =
        written.kind === 'skip'
          ? { ...base, text: '', status: 'skipped' as const, skipReason: written.reason }
          : {
              ...base,
              text: written.text,
              // A figure from nowhere (a price, a phone) never goes out on its own: the owner
              // approves it first, whatever the autonomy level (docs/06 §3.3).
              status:
                level === 'suggest' || written.ungrounded.length
                  ? ('draft' as const)
                  : ('sending' as const),
              skipReason: null,
            };
      if (!(await this.store.insertMessage(ws, row))) {
        // Another run wrote this step meanwhile.
        await this.#next(ws, job, closes, now);
        return 'repeated';
      }
      let outcome: StepOutcome;
      if (row.status === 'skipped') {
        keep = true;
        outcome = 'skipped';
      } else if (row.status === 'draft') {
        keep = true;
        outcome = 'drafted';
      } else {
        const sent = await this.sender.send(ws, row, null, now);
        if (sent.status !== 'sent') {
          // The conversation refused it (the customer wrote, a person took over, closed, out of
          // the window): the cycle ends. A channel failure moves on to the next step.
          const reason = STOP_ON_REFUSAL[sent.reason];
          if (reason) return await stop(reason);
          outcome = 'send_failed';
        } else {
          keep = true;
          outcome = 'sent';
        }
      }
      await this.#next(ws, job, closes, now);
      return outcome;
    } finally {
      if (!keep) await this.settings.release(ws, reservation);
    }
  }

  /** The cycle's next step, placed in the window; or its end. */
  async #next(ws: WorkspaceId, job: CareJob, closes: Date, now: Date): Promise<void> {
    const due = stepDue(job.template, job.step + 1, job.anchorAt);
    const at = due ? placeInWindow(due, closes) : null;
    if (!at) {
      await this.store.finish(ws, job, now);
      return;
    }
    await this.store.advance(ws, job, job.step + 1, at, now);
  }
}
