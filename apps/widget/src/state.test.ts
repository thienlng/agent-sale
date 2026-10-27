import { describe, expect, it } from 'vitest';
import { initialState, reduce, type State } from './state.js';
import type { WidgetMessage, WidgetPollResponse } from './types.js';

const msg = (over: Partial<WidgetMessage> & { id: string }): WidgetMessage => ({
  role: 'agent',
  text: 'hi',
  imageUrl: null,
  clientMessageId: null,
  at: '2026-10-27T10:00:00.000Z',
  ...over,
});
const poll = (messages: WidgetMessage[], over: Partial<WidgetPollResponse> = {}) =>
  ({
    type: 'poll',
    res: { messages, botTyping: false, phoneCaptured: false, phoneRequired: false, ...over },
  }) as const;
const sendMsg = (id: string, text = 'hello') =>
  ({
    type: 'send',
    message: { id, text, imageUrl: null, at: '2026-10-27T10:00:00.000Z' },
  }) as const;

describe('widget state', () => {
  it('starts closed with the greeting as the first agent bubble', () => {
    const s = initialState('Xin chào');
    expect(s.open).toBe(false);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: 'agent', text: 'Xin chào', status: 'sent' });
    expect(s.unread).toBe(0);
  });

  it('transitions closed -> open -> closed and clears unread on open', () => {
    let s: State = initialState('g');
    s = reduce(s, poll([msg({ id: 'a1' })]));
    expect(s.unread).toBe(1);
    s = reduce(s, { type: 'open' });
    expect(s.open).toBe(true);
    expect(s.unread).toBe(0);
    s = reduce(s, { type: 'close' });
    expect(s.open).toBe(false);
  });

  it('send adds a pending customer message and marks awaiting', () => {
    const s = reduce(initialState('g'), sendMsg('c1'));
    const last = s.messages[s.messages.length - 1];
    expect(last).toMatchObject({ id: 'c1', role: 'customer', status: 'pending' });
    expect(s.awaiting).toBe(true);
  });

  it('ack replaces the pending message by id', () => {
    let s = reduce(initialState('g'), sendMsg('c1'));
    s = reduce(s, {
      type: 'ack',
      id: 'c1',
      message: msg({ id: 'c1', role: 'customer', text: 'hello' }),
    });
    const mine = s.messages.filter((m) => m.role === 'customer');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.status).toBe('sent');
  });

  it('poll merges messages de-duplicated by id', () => {
    let s = initialState('g');
    s = reduce(s, poll([msg({ id: 'a1' }), msg({ id: 'a2' })]));
    s = reduce(s, poll([msg({ id: 'a2' }), msg({ id: 'a3' })]));
    expect(s.messages.filter((m) => m.role === 'agent' && m.id !== 'greeting')).toHaveLength(3);
    expect(s.cursor).toBe('a3');
  });

  it('does not duplicate the visitor message when the poll returns it under a server id', () => {
    let s = reduce(initialState('g'), sendMsg('c1', 'hello'));
    s = reduce(s, {
      type: 'ack',
      id: 'c1',
      message: msg({ id: 'c1', role: 'customer', text: 'hello', clientMessageId: 'c1' }),
    });
    s = reduce(
      s,
      poll([msg({ id: 'srv-1', role: 'customer', text: 'hello', clientMessageId: 'c1' })]),
    );
    expect(s.messages.filter((m) => m.role === 'customer')).toHaveLength(1);
    // the same text sent twice stays two bubbles
    s = reduce(s, sendMsg('c2', 'hello'));
    s = reduce(
      s,
      poll([msg({ id: 'srv-2', role: 'customer', text: 'hello', clientMessageId: 'c2' })]),
    );
    expect(s.messages.filter((m) => m.role === 'customer')).toHaveLength(2);
  });

  it('matches an own message by clientMessageId, not by its text', () => {
    let s = reduce(initialState('g'), sendMsg('c1', 'hello'));
    // a different visitor-side message with the same text but another client id is a new bubble
    s = reduce(
      s,
      poll([msg({ id: 'srv-9', role: 'customer', text: 'hello', clientMessageId: 'other' })]),
    );
    expect(s.messages.filter((m) => m.role === 'customer')).toHaveLength(2);
  });

  it('counts unread only when closed and the message is from the agent', () => {
    let s = initialState('g');
    s = reduce(s, poll([msg({ id: 'c9', role: 'customer' }), msg({ id: 'a1' })]));
    expect(s.unread).toBe(1);
    s = reduce(s, { type: 'open' });
    s = reduce(s, poll([msg({ id: 'a2' })]));
    expect(s.unread).toBe(0);
  });

  it('a new agent message ends awaiting; typing and phone flags follow the poll', () => {
    let s = reduce(initialState('g'), sendMsg('c1'));
    s = reduce(s, poll([], { botTyping: true }));
    expect(s.botTyping).toBe(true);
    expect(s.awaiting).toBe(true);
    s = reduce(s, poll([msg({ id: 'a1' })], { phoneCaptured: true }));
    expect(s.awaiting).toBe(false);
    expect(s.phoneCaptured).toBe(true);
  });

  it('phoneRequired switches the input mode to phone', () => {
    let s = reduce(initialState('g'), poll([], { phoneRequired: true }));
    expect(s.inputMode).toBe('phone');
    s = reduce(s, { type: 'phoneSaved' });
    expect(s.inputMode).toBe('text');
    expect(s.phoneCaptured).toBe(true);
    s = reduce(initialState('g'), { type: 'phoneRequired' });
    expect(s.inputMode).toBe('phone');
  });

  it('send failure and retry flip the message status', () => {
    let s = reduce(initialState('g'), sendMsg('c1'));
    s = reduce(s, { type: 'sendFailed', id: 'c1' });
    expect(s.messages.find((m) => m.id === 'c1')?.status).toBe('failed');
    s = reduce(s, { type: 'retry', id: 'c1' });
    expect(s.messages.find((m) => m.id === 'c1')?.status).toBe('pending');
  });
});

describe('history restore', () => {
  it('a restored poll never counts as unread', () => {
    const s = reduce(initialState('g'), {
      type: 'poll',
      restored: true,
      res: {
        messages: [msg({ id: 'a1' }), msg({ id: 'a2' })],
        botTyping: false,
        phoneCaptured: false,
        phoneRequired: false,
      },
    });
    expect(s.unread).toBe(0);
    expect(s.messages).toHaveLength(3);
    expect(reduce(s, poll([msg({ id: 'a3' })])).unread).toBe(1);
  });

  it('awaitTimeout stops awaiting', () => {
    const s = reduce(reduce(initialState('g'), sendMsg('c1')), { type: 'awaitTimeout' });
    expect(s.awaiting).toBe(false);
  });
});
