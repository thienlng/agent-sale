import { createApi, type Api } from './api.js';
import { compressImage } from './image.js';
import { checkPhone } from './phone.js';
import { createPoller, type PollMode } from './poller.js';
import { beep } from './sound.js';
import { initialState, reduce, type Action, type State } from './state.js';
import { firstUrlKey, muteKey, readItem, removeItem, tokenKey, writeItem } from './storage.js';
import { getStrings } from './strings.js';
import type { WidgetConfig, WidgetSendRequest } from './types.js';
import { uuid } from './uuid.js';
import { createView } from './view.js';

declare global {
  interface Window {
    __rapizWidget?: unknown;
  }
}

const DEFAULT_COLOR = '#F97316';
const MAX_RETRIES = 3;
const AWAIT_TIMEOUT_MS = 60000;

function defaultConfig(): WidgetConfig {
  const s = getStrings('vi');
  return {
    color: DEFAULT_COLOR,
    position: 'right',
    agentName: s.defaultAgent,
    avatarUrl: null,
    greeting: s.defaultGreeting,
    phonePrompt: s.defaultPhonePrompt,
    phoneChipText: s.defaultPhoneChip,
    language: 'vi',
  };
}

interface Target {
  key: string;
  origin: string;
}

function resolveTarget(script: HTMLScriptElement): Target | null {
  let url: URL;
  try {
    url = new URL(script.src, window.location.href);
  } catch {
    return null;
  }
  const key = url.searchParams.get('key') || script.getAttribute('data-key');
  if (!key) return null;
  const api = script.getAttribute('data-api');
  return { key, origin: api ? api.replace(/\/+$/, '') : url.origin };
}

/** Finds the widget `<script>`: `document.currentScript`, else the last script whose src contains `widget.js`. */
export function findScript(): HTMLScriptElement | null {
  const cur = document.currentScript;
  if (cur instanceof HTMLScriptElement && cur.src) return cur;
  const all = document.getElementsByTagName('script');
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s && s.src.indexOf('widget.js') !== -1) return s;
  }
  return null;
}

/** Starts the widget for the given script tag. Resolves once the config request settled and the UI (if any) is mounted. */
export async function boot(script: HTMLScriptElement | null): Promise<void> {
  if (!script || window.__rapizWidget) return;
  const target = resolveTarget(script);
  if (!target) return;
  window.__rapizWidget = true;

  const api = createApi(target.origin, target.key);
  const res = await api.config();
  if (res.status >= 400 && res.status < 500) {
    window.__rapizWidget = undefined; // not served here; allow a later retry with another tag
    return;
  }
  const config: WidgetConfig =
    res.body && typeof res.body === 'object'
      ? { ...defaultConfig(), ...res.body }
      : defaultConfig();

  const mount = (): void => start(api, target.key, config);
  if (document.readyState === 'loading') {
    await new Promise<void>((r) =>
      document.addEventListener('DOMContentLoaded', () => r(), { once: true }),
    );
  }
  mount();
}

interface Outgoing {
  id: string;
  text?: string;
  attachmentUrl?: string;
}

function start(api: Api, key: string, config: WidgetConfig): void {
  const strings = getStrings(config.language);
  let state: State = initialState(config.greeting);
  let token = readItem(tokenKey(key));
  let muted = readItem(muteKey(key)) === '1';
  let gestured = false;
  let restoring = token !== null; // first poll of a returning visitor restores history silently
  let awaitingSince = 0;
  let sentFirst = token !== null; // an existing visitor already delivered the greeting
  let chain: Promise<void> = Promise.resolve();
  const held: Outgoing[] = [];

  const dispatch = (a: Action): void => {
    state = reduce(state, a);
    view.update(state);
  };

  const mode = (): PollMode => (!state.open ? 'closed' : state.awaiting ? 'awaiting' : 'open');

  const poller = createPoller({
    mode,
    run: async () => {
      if (!token) return true;
      const r = await api.poll(token, state.cursor);
      if (r.status === 401) {
        dropToken();
        return true;
      }
      if (!r.body) return r.status === 404 ? true : false;
      const before = state.unread;
      dispatch({ type: 'poll', res: r.body, restored: restoring });
      restoring = false;
      if (state.unread > before && !muted && gestured) beep();
      if (state.awaiting && Date.now() - awaitingSince > AWAIT_TIMEOUT_MS) {
        dispatch({ type: 'awaitTimeout' });
      }
      return true;
    },
  });

  const view = createView(config, strings, {
    onToggle(open) {
      dispatch({ type: open ? 'open' : 'close' });
      if (open) view.focusInput();
      if (poller.running) poller.kick();
    },
    onSend: (text) => enqueue({ id: uuid(), text }, true),
    onPickImage: (file) => void sendImage(file),
    onRetry(id) {
      const m = state.messages.find((x) => x.id === id);
      if (!m) return;
      dispatch({ type: 'retry', id });
      enqueue(m.imageUrl ? { id, attachmentUrl: m.imageUrl } : { id, text: m.text }, false);
    },
    onPhoneChip: () => dispatch({ type: 'inputMode', mode: 'phone' }),
    onPhoneCancel: () => {
      view.setPhoneError(null);
      dispatch({ type: 'inputMode', mode: 'text' });
    },
    onPhoneSubmit: (raw) => void submitPhone(raw),
    onMute() {
      muted = !muted;
      if (muted) writeItem(muteKey(key), '1');
      else removeItem(muteKey(key));
      view.setMuted(muted);
    },
  });

  const markGesture = (): void => {
    gestured = true;
  };
  document.addEventListener('pointerdown', markGesture, { once: true, capture: true });
  document.addEventListener('keydown', markGesture, { once: true, capture: true });

  function dropToken(): void {
    token = null;
    sentFirst = false;
    restoring = false;
    removeItem(tokenKey(key));
    removeItem(firstUrlKey(key));
    poller.stop();
    dispatch({ type: 'reset' });
    dispatch({ type: 'token', has: false });
  }

  function firstUrl(): string {
    const stored = readItem(firstUrlKey(key));
    if (stored) return stored;
    const u = window.location.href.slice(0, 1000);
    writeItem(firstUrlKey(key), u);
    return u;
  }

  function buildRequest(m: Outgoing): WidgetSendRequest {
    const body: WidgetSendRequest = {
      clientMessageId: m.id,
      page: { url: window.location.href.slice(0, 1000), title: document.title.slice(0, 150) },
    };
    if (m.text !== undefined) body.text = m.text;
    if (m.attachmentUrl !== undefined) body.attachmentUrl = m.attachmentUrl;
    if (!sentFirst) {
      body.firstUrl = firstUrl();
      if (document.referrer) body.referrer = document.referrer.slice(0, 500);
      body.seen = [config.greeting.slice(0, 300)];
    }
    return body;
  }

  function enqueue(m: Outgoing, fresh: boolean): void {
    if (fresh) {
      awaitingSince = Date.now();
      dispatch({
        type: 'send',
        message: {
          id: m.id,
          text: m.text ?? '',
          imageUrl: m.attachmentUrl ?? null,
          at: new Date().toISOString(),
        },
      });
    }
    view.setNotice(null);
    chain = chain.then(() => deliver(m)).catch(() => undefined);
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function deliver(m: Outgoing): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const r = await api.send(token, buildRequest(m));
      if (r.body) {
        token = r.body.visitorToken;
        writeItem(tokenKey(key), token);
        sentFirst = true;
        restoring = false;
        dispatch({ type: 'token', has: true });
        dispatch({ type: 'ack', id: m.id, message: r.body.message });
        if (!poller.running) poller.start();
        poller.kick();
        return;
      }
      if (r.status === 401) {
        dropToken(); // next attempt starts a new visitor
        if (attempt < MAX_RETRIES) continue;
      } else if (r.status === 409 && r.code === 'PHONE_REQUIRED') {
        held.push(m);
        dispatch({ type: 'phoneRequired' });
        return;
      } else if (r.status === 429) {
        view.setNotice(strings.rateLimited);
        dispatch({ type: 'sendFailed', id: m.id });
        return;
      } else if ((r.status === 0 || r.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(2000 * Math.pow(2, attempt)); // 2 s, 4 s, 8 s
        continue;
      }
      dispatch({ type: 'sendFailed', id: m.id });
      return;
    }
  }

  async function sendImage(file: File): Promise<void> {
    view.setNotice(null);
    view.setBusy(true);
    try {
      const blob = await compressImage(file);
      // Without a token the upload itself starts the visitor and answers its token.
      const up = await api.upload(
        token,
        blob,
        token
          ? undefined
          : {
              firstUrl: firstUrl(),
              referrer: document.referrer.slice(0, 500),
              pageUrl: window.location.href.slice(0, 500),
              pageTitle: document.title.slice(0, 150),
            },
      );
      if (up.status === 401) {
        dropToken();
        view.setNotice(strings.uploadFailed);
        return;
      }
      if (up.status === 429) {
        view.setNotice(strings.rateLimited);
        return;
      }
      if (!up.body) {
        view.setNotice(strings.uploadFailed);
        return;
      }
      if (up.body.visitorToken && !token) {
        token = up.body.visitorToken;
        writeItem(tokenKey(key), token);
      }
      enqueue({ id: uuid(), attachmentUrl: up.body.url }, true);
    } finally {
      view.setBusy(false);
    }
  }

  async function submitPhone(raw: string): Promise<void> {
    const phone = checkPhone(raw);
    if (!phone) {
      view.setPhoneError(strings.invalidPhone);
      return;
    }
    if (!token) {
      view.setPhoneError(strings.genericError);
      return;
    }
    view.setPhoneError(null);
    view.setBusy(true);
    try {
      const r = await api.phone(token, phone);
      if (r.status === 422) {
        view.setPhoneError(strings.invalidPhone);
        return;
      }
      if (r.status === 429) {
        view.setPhoneError(strings.rateLimited);
        return;
      }
      if (r.status === 401) dropToken();
      if (!r.body) {
        view.setPhoneError(strings.genericError);
        return;
      }
      dispatch({ type: 'phoneSaved' });
      for (const m of held.splice(0)) enqueue(m, false);
    } finally {
      view.setBusy(false);
    }
  }

  view.setMuted(muted);
  view.update(state);
  dispatch({ type: 'token', has: token !== null });
  document.body.appendChild(view.host);
  if (token) poller.start(); // returning visitor: restore history, poll slowly while closed
  if (token) void poller.kick();
}
