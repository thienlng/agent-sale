import { describe, expect, it } from 'vitest';

import { buildEvaluationInput, parseEvaluationOutput } from '../domain/evaluation-prompt.js';
import {
  hcmDay,
  isCustomerMessage,
  nextHcmMidnight,
  nextRunAfter,
  shouldSkip,
} from '../domain/schedule.js';
import { applyEvaluation, becameComplaint, blankSignal, overrideStage } from '../domain/signal.js';

const NOW = new Date('2026-11-11T03:00:00.000Z');
const CONV = '0190f5c2-0000-7000-8000-00000000c001';
const at = (iso: string) => new Date(iso);

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    stage: 'price_asked',
    intent: 'Hỏi giá áo khoác size M',
    mood: 'neutral',
    needsHuman: false,
    needsHumanReason: null,
    followUpAt: null,
    followUpReason: null,
    note: 'Khách hỏi giá áo khoác.',
    ...over,
  });

describe('rule 1: scheduling', () => {
  it('runs the idle evaluation idle minutes after the customer message', () => {
    expect(nextRunAfter(null, at('2026-11-11T03:00:00Z'), 45)).toEqual(at('2026-11-11T03:45:00Z'));
  });

  it('pushes the run back on a newer message and never pulls it forward', () => {
    const existing = at('2026-11-11T03:45:00Z');
    expect(nextRunAfter(existing, at('2026-11-11T03:10:00Z'), 45)).toEqual(
      at('2026-11-11T03:55:00Z'),
    );
    // An older event processed late keeps the later run.
    expect(nextRunAfter(existing, at('2026-11-11T02:00:00Z'), 45)).toEqual(existing);
  });

  it('schedules on customer messages only, not on staff echoes', () => {
    expect(isCustomerMessage('message')).toBe(true);
    expect(isCustomerMessage('echo')).toBe(false);
  });
});

describe('rule 2: skips', () => {
  const base = {
    mode: 'auto' as const,
    isTest: false,
    status: 'open' as const,
    hasNewCustomerMessage: true,
  };

  it('evaluates an open conversation with a new customer message in auto mode', () => {
    expect(shouldSkip(base)).toBeNull();
  });

  it('skips manual mode, test and closed conversations, and nothing new', () => {
    expect(shouldSkip({ ...base, mode: 'manual' })).toBe('manual_mode');
    expect(shouldSkip({ ...base, isTest: true })).toBe('test');
    expect(shouldSkip({ ...base, status: 'resolved' })).toBe('closed');
    expect(shouldSkip({ ...base, status: 'spam' })).toBe('closed');
    expect(shouldSkip({ ...base, hasNewCustomerMessage: false })).toBe('nothing_new');
  });
});

describe('rule 3: the counting day is Asia/Ho_Chi_Minh', () => {
  it('starts the day at 17:00 UTC', () => {
    expect(hcmDay(at('2026-11-11T16:59:59Z'))).toBe('2026-11-11');
    expect(hcmDay(at('2026-11-11T17:00:00Z'))).toBe('2026-11-12');
  });

  it('puts a capped job back at the next local midnight', () => {
    expect(nextHcmMidnight(at('2026-11-11T03:00:00Z'))).toEqual(at('2026-11-11T17:00:00Z'));
    expect(nextHcmMidnight(at('2026-11-11T17:00:00Z'))).toEqual(at('2026-11-12T17:00:00Z'));
  });
});

describe('rule 4: evaluation input and output', () => {
  it('starts from the previous note, else from the stored summary', () => {
    const facts = {
      hasCustomerRecord: true,
      phoneKnown: false,
      status: 'open' as const,
      lastMessageSender: 'customer' as const,
      awaitingSince: null,
      stage: 'new',
      stageLocked: false,
    };
    const messages = [
      { sender: 'customer' as const, text: 'Giá bao nhiêu?', at: NOW.toISOString() },
    ];
    const withNote = buildEvaluationInput({
      previousNote: 'Ghi chú cũ',
      summary: 'Tóm tắt',
      messages,
      facts,
      now: NOW,
    });
    expect(withNote).toContain('PREVIOUS NOTE:\nGhi chú cũ');
    expect(withNote).not.toContain('Tóm tắt');
    expect(withNote).toContain('Khách: Giá bao nhiêu?');
    expect(withNote).toMatch(/FACTS: now=.*customer_record=yes; phone_known=no/);
    const first = buildEvaluationInput({
      previousNote: null,
      summary: 'Tóm tắt',
      messages,
      facts,
      now: NOW,
    });
    expect(first).toContain('EARLIER SUMMARY:\nTóm tắt');
  });

  it('accepts a valid answer, also fenced', () => {
    expect(parseEvaluationOutput(answer(), NOW)?.stage).toBe('price_asked');
    expect(parseEvaluationOutput('```json\n' + answer() + '\n```', NOW)?.intent).toBe(
      'Hỏi giá áo khoác size M',
    );
  });

  it('rejects invalid JSON, unknown enums and over-long fields', () => {
    expect(parseEvaluationOutput('not json', NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ stage: 'maybe' }), NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ intent: 'x'.repeat(161) }), NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ needsHumanReason: 'x'.repeat(201) }), NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ followUpReason: 'x'.repeat(201) }), NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ note: 'x'.repeat(1501) }), NOW)).toBeNull();
  });

  it('requires a follow-up in the future and at most 60 days away', () => {
    const ok = parseEvaluationOutput(
      answer({ followUpAt: '2026-11-12T02:00:00+07:00', followUpReason: 'Hẹn mai' }),
      NOW,
    );
    expect(ok?.followUpAt).toBe('2026-11-12T02:00:00+07:00');
    expect(parseEvaluationOutput(answer({ followUpAt: '2026-11-10T00:00:00Z' }), NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ followUpAt: '2027-02-01T00:00:00Z' }), NOW)).toBeNull();
    expect(parseEvaluationOutput(answer({ followUpAt: 'tomorrow' }), NOW)).toBeNull();
  });
});

describe('rule 5: write rules', () => {
  const out = (over: Record<string, unknown> = {}) => {
    const parsed = parseEvaluationOutput(answer(over), NOW);
    if (!parsed) throw new Error('fixture must parse');
    return parsed;
  };
  const cover = {
    lastMessageAt: at('2026-11-11T02:50:00Z'),
    lastCustomerMessageAt: at('2026-11-11T02:40:00Z'),
    contactId: null,
  };

  it('writes the answer and moves evaluated_until to the last covered message', () => {
    const next = applyEvaluation(blankSignal(CONV, null, NOW), out(), cover, NOW);
    expect(next).toMatchObject({
      stage: 'price_asked',
      intent: 'Hỏi giá áo khoác size M',
      note: 'Khách hỏi giá áo khoác.',
      evaluatedUntil: cover.lastMessageAt,
      evaluatedAt: NOW,
      version: 1,
    });
  });

  it('keeps a stage a member locked', () => {
    const locked = overrideStage(blankSignal(CONV, null, NOW), { stage: 'won' }, NOW);
    expect(locked.stageLocked).toBe(true);
    const next = applyEvaluation(locked, out({ stage: 'exploring', mood: 'positive' }), cover, NOW);
    expect(next.stage).toBe('won');
    expect(next.mood).toBe('positive');
  });

  it('unlocks the stage on request without changing it', () => {
    const locked = overrideStage(blankSignal(CONV, null, NOW), { stage: 'won' }, NOW);
    const open = overrideStage(locked, { stageLocked: false }, NOW);
    expect(open).toMatchObject({ stage: 'won', stageLocked: false });
  });

  it('clears a dismissal only when a newer customer message was covered', () => {
    const dismissed = {
      ...blankSignal(CONV, null, NOW),
      dismissedUntilMessageAfter: at('2026-11-11T02:45:00Z'),
    };
    // The newest customer message (02:40) is older than the dismissal: it stays.
    expect(applyEvaluation(dismissed, out(), cover, NOW).dismissedUntilMessageAfter).toEqual(
      at('2026-11-11T02:45:00Z'),
    );
    const newer = { ...cover, lastCustomerMessageAt: at('2026-11-11T02:46:00Z') };
    expect(applyEvaluation(dismissed, out(), newer, NOW).dismissedUntilMessageAfter).toBeNull();
  });

  it('drops reasons that do not apply', () => {
    const next = applyEvaluation(
      blankSignal(CONV, null, NOW),
      out({ needsHuman: false, needsHumanReason: 'x', followUpAt: null, followUpReason: 'y' }),
      cover,
      NOW,
    );
    expect(next.needsHumanReason).toBeNull();
    expect(next.followUpReason).toBeNull();
  });

  it('raises the complaint alert only on the transition', () => {
    const calm = blankSignal(CONV, null, NOW);
    const angry = applyEvaluation(calm, out({ mood: 'complaint' }), cover, NOW);
    expect(becameComplaint(calm, angry)).toBe(true);
    const still = applyEvaluation(angry, out({ mood: 'complaint' }), cover, NOW);
    expect(becameComplaint(angry, still)).toBe(false);
  });
});
