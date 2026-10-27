import type { WidgetMessage, WidgetPollResponse } from './types.js';

export type MessageStatus = 'sent' | 'pending' | 'failed';
export interface LocalMessage extends WidgetMessage {
  status: MessageStatus;
}

export interface State {
  open: boolean;
  messages: LocalMessage[];
  unread: number;
  /** A visitor message was sent and no agent reply has arrived yet. */
  awaiting: boolean;
  botTyping: boolean;
  phoneCaptured: boolean;
  phoneRequired: boolean;
  inputMode: 'text' | 'phone';
  /** Id of the last server message seen by the poller (`after` cursor). */
  cursor: string | null;
  /** A visitor token exists (a conversation can be linked to a phone number). */
  hasToken: boolean;
  /** Server ids already merged from polls (used to match our own echoes). */
  serverIds: string[];
}

export const GREETING_ID = 'greeting';

export type Action =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'send'; message: { id: string; text: string; imageUrl: string | null; at: string } }
  | { type: 'ack'; id: string; message: WidgetMessage }
  | { type: 'sendFailed'; id: string }
  | { type: 'retry'; id: string }
  /** `restored`: history of a returning visitor; it never counts as unread. */
  | { type: 'poll'; res: WidgetPollResponse; restored?: boolean }
  | { type: 'token'; has: boolean }
  | { type: 'awaitTimeout' }
  | { type: 'phoneRequired' }
  | { type: 'inputMode'; mode: 'text' | 'phone' }
  | { type: 'phoneSaved' }
  | { type: 'reset' };

export function initialState(greeting: string, now: string = new Date().toISOString()): State {
  return {
    open: false,
    messages: [
      {
        id: GREETING_ID,
        role: 'agent',
        text: greeting,
        imageUrl: null,
        clientMessageId: null,
        at: now,
        status: 'sent',
      },
    ],
    unread: 0,
    awaiting: false,
    botTyping: false,
    phoneCaptured: false,
    phoneRequired: false,
    inputMode: 'text',
    cursor: null,
    hasToken: false,
    serverIds: [],
  };
}

function setStatus(s: State, id: string, status: MessageStatus): State {
  return { ...s, messages: s.messages.map((m) => (m.id === id ? { ...m, status } : m)) };
}

function merge(s: State, res: WidgetPollResponse, restored: boolean): State {
  const messages = s.messages.slice();
  const serverIds = s.serverIds.slice();
  let unread = s.unread;
  let gotAgent = false;
  let cursor = s.cursor;

  for (const incoming of res.messages) {
    cursor = incoming.id;
    if (serverIds.indexOf(incoming.id) !== -1) continue;
    serverIds.push(incoming.id);
    const sameId = messages.findIndex((m) => m.id === incoming.id);
    if (sameId !== -1) {
      messages[sameId] = { ...incoming, status: 'sent' };
      continue;
    }
    if (incoming.role === 'customer') {
      // Our own echo comes back with a server id: adopt it (matched by the id we generated).
      const mine = incoming.clientMessageId
        ? messages.findIndex(
            (m) => m.role === 'customer' && m.clientMessageId === incoming.clientMessageId,
          )
        : -1;
      if (mine !== -1) {
        messages[mine] = { ...incoming, status: 'sent' };
        continue;
      }
    } else {
      gotAgent = true;
      if (!s.open && !restored) unread += 1;
    }
    messages.push({ ...incoming, status: 'sent' });
  }

  const phoneCaptured = s.phoneCaptured || res.phoneCaptured;
  const phoneRequired = !phoneCaptured && res.phoneRequired;
  return {
    ...s,
    messages,
    serverIds,
    cursor,
    unread,
    awaiting: gotAgent ? false : s.awaiting,
    botTyping: res.botTyping,
    phoneCaptured,
    phoneRequired,
    inputMode: phoneRequired ? 'phone' : s.inputMode,
  };
}

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'open':
      return { ...s, open: true, unread: 0 };
    case 'close':
      return { ...s, open: false };
    case 'send':
      return {
        ...s,
        awaiting: true,
        messages: [
          ...s.messages,
          {
            ...a.message,
            role: 'customer',
            clientMessageId: a.message.id,
            status: 'pending' as const,
          },
        ],
      };
    case 'ack': {
      const messages = s.messages.map((m) =>
        m.id === a.id ? { ...a.message, status: 'sent' as const } : m,
      );
      return { ...s, messages };
    }
    case 'sendFailed':
      return { ...setStatus(s, a.id, 'failed'), awaiting: false };
    case 'retry':
      return { ...setStatus(s, a.id, 'pending'), awaiting: true };
    case 'poll':
      return merge(s, a.res, a.restored === true);
    case 'token':
      return { ...s, hasToken: a.has };
    case 'awaitTimeout':
      return { ...s, awaiting: false };
    case 'phoneRequired':
      return s.phoneCaptured ? s : { ...s, phoneRequired: true, inputMode: 'phone' };
    case 'inputMode':
      return { ...s, inputMode: a.mode };
    case 'phoneSaved':
      return { ...s, phoneCaptured: true, phoneRequired: false, inputMode: 'text' };
    case 'reset':
      return { ...s, cursor: null, serverIds: [] };
  }
}

/** The phone chip shows after the first real agent message, until a phone is captured. */
export function showPhoneChip(s: State): boolean {
  return (
    s.hasToken &&
    !s.phoneCaptured &&
    s.inputMode === 'text' &&
    s.messages.some((m) => m.role === 'agent' && m.id !== GREETING_ID)
  );
}
