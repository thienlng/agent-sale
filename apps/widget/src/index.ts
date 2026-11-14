import { createApi, type Api } from './api.js';
import { compressImage } from './image.js';
import { checkPhone } from './phone.js';
import { pageNav, sectionTarget, visibleSections } from './page-context.js';
import { createPoller, type PollMode } from './poller.js';
import { initialState, reduce, type Action, type State } from './state.js';
import { firstUrlKey, readItem, removeItem, reopenKey, tokenKey, writeItem } from './storage.js';
import { getStrings } from './strings.js';
import { challengeToken } from './turnstile.js';
import type { WidgetConfig, WidgetSendRequest } from './types.js';
import { uuid } from './uuid.js';
import { createView, sameDocument } from './view.js';

declare global {
  interface Window {
    __rapizWidget?: unknown;
  }
}

const DEFAULT_COLOR = '#F97316';
const MAX_RETRIES = 3;
const AWAIT_TIMEOUT_MS = 60000;
/** A panel left open for a suggested page reopens there when the page loads within this time. */
const REOPEN_MS = 30000;

const reducedMotion = (): boolean =>
  !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The bottom of a fixed or sticky bar at the top of the page (a site header), else 0. */
function stickyTop(): number {
  const probe = document.elementFromPoint
    ? document.elementFromPoint(window.innerWidth / 2, 2)
    : null;
  for (let el = probe; el && el !== document.body; el = el.parentElement) {
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') {
      const bottom = el.getBoundingClientRect().bottom;
      return bottom > 0 && bottom < window.innerHeight / 3 ? bottom : 0;
    }
  }
  return 0;
}

/** Scrolls a section of the page into view, then rings it once in the site's colour. */
function reveal(target: HTMLElement, color: string): void {
  const behavior = reducedMotion() ? 'auto' : 'smooth';
  const cover = stickyTop();
  if (cover > 0)
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY - cover - 12,
      behavior,
    });
  else target.scrollIntoView({ behavior, block: 'start' });
  if (!target.animate) return;
  const ring = /^#[0-9a-f]{3,8}$/i.test(color) ? color : DEFAULT_COLOR;
  target.animate(
    [
      { outline: `3px solid ${ring}`, outlineOffset: '-3px' },
      { outline: '3px solid transparent', outlineOffset: '-3px' },
    ],
    { duration: 1600, delay: reducedMotion() ? 0 : 450, easing: 'ease-out' },
  );
}

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
  /** `data-starters="Xem bảng giá|Đặt lịch demo"`: questions offered under the greeting. */
  starters: string[];
}

/** At most 4 starter questions of up to 80 characters, `|` separated. */
export function readStarters(raw: string | null): string[] {
  return (raw ?? '')
    .split('|')
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.length <= 80)
    .slice(0, 4);
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
  return {
    key,
    origin: api ? api.replace(/\/+$/, '') : url.origin,
    starters: readStarters(script.getAttribute('data-starters')),
  };
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

  const mount = (): void => start(api, target.key, config, target.starters);
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

function start(api: Api, key: string, config: WidgetConfig, starters: string[]): void {
  const strings = getStrings(config.language);
  let state: State = initialState(config.greeting);
  let token = readItem(tokenKey(key));
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
      dispatch({ type: 'poll', res: r.body, restored: restoring });
      restoring = false;
      if (state.awaiting && Date.now() - awaitingSince > AWAIT_TIMEOUT_MS) {
        dispatch({ type: 'awaitTimeout' });
      }
      return true;
    },
  });

  const view = createView(
    config,
    strings,
    {
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
      onNavigate(url) {
        let to: URL;
        try {
          to = new URL(url, window.location.href);
        } catch {
          return;
        }
        if (to.origin !== window.location.origin || !/^https?:$/.test(to.protocol)) return;
        const target = sameDocument(to.href) ? sectionTarget(to.hash) : null;
        if (target) {
          // A full-screen panel would hide the section it points at.
          if (window.innerWidth <= 640) dispatch({ type: 'close' });
          reveal(target, config.color);
          return;
        }
        writeItem(reopenKey(key), String(Date.now()));
        window.location.assign(to.href);
      },
    },
    { starters },
  );
  window.addEventListener('offline', () => view.setNotice(strings.offline));
  window.addEventListener('online', () => view.setNotice(null));

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
      page: {
        url: window.location.href.slice(0, 1000),
        title: document.title.slice(0, 150),
        sections: visibleSections(),
        nav: pageNav(),
      },
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

  /** A Turnstile token for a new visitor when the site requires one, else undefined. */
  async function challenge(): Promise<string | undefined> {
    if (token || !config.turnstileSiteKey) return undefined;
    return (await challengeToken(config.turnstileSiteKey)) ?? undefined;
  }

  async function deliver(m: Outgoing): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const request = buildRequest(m);
      const proof = await challenge();
      if (proof) request.turnstileToken = proof;
      const r = await api.send(token, request);
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
      } else if (r.status === 403 && r.code === 'CHALLENGE_REQUIRED' && attempt < MAX_RETRIES) {
        continue; // a fresh challenge on the next attempt
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
      const proof = await challenge();
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
              ...(proof ? { turnstileToken: proof } : {}),
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

  view.update(state);
  dispatch({ type: 'token', has: token !== null });
  document.body.appendChild(view.host);
  // Arrived from a suggestion: keep the conversation open, and find a marked part without an id.
  const reopen = Number(readItem(reopenKey(key)) ?? 0);
  removeItem(reopenKey(key));
  if (token && Date.now() - reopen < REOPEN_MS) dispatch({ type: 'open' });
  if (window.location.hash && !document.getElementById(window.location.hash.slice(1))) {
    const target = sectionTarget(window.location.hash);
    if (target) reveal(target, config.color);
  }
  if (token) poller.start(); // returning visitor: restore history, poll slowly while closed
  if (token) void poller.kick();
}
