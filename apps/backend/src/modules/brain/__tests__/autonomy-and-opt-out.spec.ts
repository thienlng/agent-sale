import { describe, expect, it } from 'vitest';

import { AUTONOMY_REGISTRY, resolveLevel, sendsOnItsOwn } from '../domain/autonomy.js';
import { EVALUATION_PROMPT, parseEvaluationOutput } from '../domain/evaluation-prompt.js';
import {
  answer,
  brainHarness,
  CONV,
  conversation,
  OTHER_WS,
  WS,
} from './factories/brain-harness.js';

const NOW = new Date('2026-11-11T03:00:00.000Z');

describe('autonomy levels (ADR-031)', () => {
  it('defaults care.send_message to suggest and only keeps levels the action allows', () => {
    expect(AUTONOMY_REGISTRY['care.send_message'].default).toBe('suggest');
    expect(resolveLevel('care.send_message', null)).toBe('suggest');
    expect(resolveLevel('care.send_message', 'act_and_report')).toBe('act_and_report');
    expect(resolveLevel('care.send_message', 'nope' as never)).toBe('suggest');
    expect(sendsOnItsOwn('suggest')).toBe(false);
    expect(sendsOnItsOwn('auto')).toBe(true);
  });

  it('lists, sets and resolves the level per business', async () => {
    const h = brainHarness();
    expect(await h.facade.levelFor(WS, 'care.send_message')).toBe('suggest');
    expect((await h.autonomy.list(WS)).actions).toEqual([
      {
        action: 'care.send_message',
        level: 'suggest',
        default: 'suggest',
        levels: ['suggest', 'act_and_report', 'auto'],
      },
    ]);
    const r = await h.facade.putAutonomy(
      WS,
      { actions: [{ action: 'care.send_message', level: 'auto' }] },
      'u1',
    );
    expect(r.actions[0]?.level).toBe('auto');
    expect(await h.facade.levelFor(WS, 'care.send_message')).toBe('auto');
    // Another business keeps its own default.
    expect(await h.facade.levelFor(OTHER_WS, 'care.send_message')).toBe('suggest');
  });

  it('refuses an unknown action or level', async () => {
    const h = brainHarness();
    await expect(
      h.autonomy.put(
        WS,
        { actions: [{ action: 'care.send_message', level: 'max' as never }] },
        'u',
      ),
    ).rejects.toThrow();
    await expect(
      h.autonomy.put(WS, { actions: [{ action: 'crm.move' as never, level: 'auto' }] }, 'u'),
    ).rejects.toThrow();
  });
});

describe('opt-out signal', () => {
  it('asks prompt v2 for optOut and reads an answer without it as no opt-out', () => {
    expect(EVALUATION_PROMPT.version).toBe(2);
    expect(parseEvaluationOutput(answer({ optOut: true }), NOW)?.optOut).toBe(true);
    const old = JSON.parse(answer()) as Record<string, unknown>;
    delete old.optOut;
    expect(parseEvaluationOutput(JSON.stringify(old), NOW)?.optOut).toBe(false);
    expect(parseEvaluationOutput(answer({ optOut: 'yes' }), NOW)).toBeNull();
  });

  it('stores the opt-out and publishes brain.signals.updated.v1 with every write', async () => {
    const h = brainHarness();
    const c = conversation({ contactId: null });
    c.messages.push({
      sender: 'customer',
      text: 'Đừng nhắn nữa nhé',
      at: '2026-11-11T02:00:00.000Z',
    });
    h.conversations.set(CONV, c);
    h.facts.set(CONV, {
      ws: WS,
      id: CONV,
      provider: 'facebook',
      status: 'open',
      contactId: null,
      customerName: 'Khách',
      customerAvatarUrl: null,
      assigneeId: null,
      awaitingSince: null,
      lastInboundAt: '2026-11-11T02:00:00.000Z',
      followUpAt: null,
      followUpNote: '',
      lastHumanReplyAt: null,
    });
    h.gateway.replies.push(answer({ stage: 'lost', optOut: true }));
    const r = await h.facade.evaluateNow(WS, CONV, 'manual');
    expect(r.signal).toMatchObject({ stage: 'lost', optOut: true });
    await h.facade.updateSignal(WS, CONV, { stage: 'won' }, NOW);
    expect(h.store.updated).toEqual([
      { workspaceId: WS, conversationId: CONV, stage: 'lost', optOut: true },
      { workspaceId: WS, conversationId: CONV, stage: 'won', optOut: true },
    ]);
  });
});
