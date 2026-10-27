import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot } from './index.js';

vi.mock('./image.js', () => ({ compressImage: async (file: File) => file }));

const config = {
  color: '#F97316',
  position: 'right',
  agentName: 'Shop A',
  avatarUrl: null,
  greeting: 'Xin chào!',
  phonePrompt: 'Để lại số điện thoại?',
  phoneChipText: 'Để lại SĐT',
  language: 'vi',
};

function script(src: string, api?: string): HTMLScriptElement {
  const el = document.createElement('script');
  el.src = src;
  if (api) el.setAttribute('data-api', api);
  document.head.appendChild(el);
  return el;
}

describe('boot behaviour', () => {
  type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;
  const base = 'https://cdn.example/api/v1/webchat/v1/sites/abc';
  const empty = { messages: [], botTyping: false, phoneCaptured: false, phoneRequired: false };
  const echo = (init: RequestInit | undefined, token = 'tok') => {
    const body = JSON.parse(String(init?.body)) as { clientMessageId: string; text?: string };
    return new Response(
      JSON.stringify({
        visitorToken: token,
        message: {
          id: body.clientMessageId,
          role: 'customer',
          text: body.text ?? '',
          imageUrl: null,
          at: '2026-10-27T10:00:00.000Z',
        },
      }),
      { status: 202 },
    );
  };
  const posts = (calls: { url: string; init: RequestInit | undefined }[]) =>
    calls.filter((c) => c.init?.method === 'POST' && c.url === `${base}/messages`);
  const polls = (calls: { url: string }[]) =>
    calls.filter((c) => c.url.startsWith(`${base}/messages`) && !c.url.endsWith('x'));
  const authOf = (c: { init: RequestInit | undefined }) =>
    (c.init?.headers as Record<string, string> | undefined)?.['Authorization'];

  async function mount(handler: Handler) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url) === base) return Promise.resolve(new Response(JSON.stringify(config)));
        return Promise.resolve(handler(String(url), init));
      }),
    );
    await boot(script('https://cdn.example/widget.js?key=abc'));
    const root = document.querySelector<HTMLElement>('[data-rapiz-widget]')!.shadowRoot!;
    const settle = async () => {
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    };
    const send = async (text: string) => {
      root.querySelector<HTMLElement>('.bubble')!.click();
      root.querySelector<HTMLTextAreaElement>('textarea')!.value = text;
      root
        .querySelector<HTMLFormElement>('form.composer')!
        .dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
    };
    return { calls, root, send, settle };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    localStorage.clear();
    delete (window as { __rapizWidget?: unknown }).__rapizWidget;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not poll before the first send or without a token', async () => {
    const { calls } = await mount(() => new Response(JSON.stringify(empty)));
    await vi.advanceTimersByTimeAsync(120000);
    expect(polls(calls)).toHaveLength(0);
  });

  // Keep first: storage.ts mirrors writes in a module-level memory map that outlives localStorage.clear().
  it('an image as the very first action uploads without a token, stores the issued token and sends it', async () => {
    const uploaded = 'https://cdn.example/webchat/ws/conn/11111111-1111-4111-8111-111111111111.jpg';
    const { calls, root, settle } = await mount((url, init) => {
      if (url.startsWith(`${base}/uploads`))
        return new Response(JSON.stringify({ url: uploaded, visitorToken: 'issued' }));
      if (init?.method === 'POST') return echo(init, 'issued');
      return new Response(JSON.stringify(empty));
    });
    root.querySelector<HTMLElement>('.bubble')!.click();
    const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' })],
    });
    input.dispatchEvent(new Event('change'));
    await settle();
    const up = calls.find((c) => c.url.startsWith(`${base}/uploads`))!;
    expect(up).toBeDefined();
    expect(authOf(up)).toBeUndefined();
    expect(up.url).toContain('firstUrl=');
    expect(root.querySelector('.notice')?.textContent ?? '').not.toContain('ảnh');
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(authOf(p[0]!)).toBe('Visitor issued');
    const sent = JSON.parse(String(p[0]!.init?.body)) as {
      attachmentUrl?: string;
      firstUrl?: string;
    };
    expect(sent.attachmentUrl).toBe(uploaded);
    expect(sent.firstUrl).toBeTruthy();
    expect(localStorage.getItem('rapiz_v_abc')).toBe('issued');
  });

  it('401 drops the token and the send starts a new visitor', async () => {
    localStorage.setItem('rapiz_v_abc', 'old');
    const { calls, send } = await mount((url, init) => {
      if (init?.method === 'POST') {
        return authOf({ init }) === 'Visitor old'
          ? new Response(JSON.stringify({ error: 'INVALID_VISITOR' }), { status: 401 })
          : echo(init, 'fresh');
      }
      return url.includes('/messages')
        ? authOf({ init }) === 'Visitor old'
          ? new Response('{}', { status: 401 })
          : new Response(JSON.stringify(empty))
        : new Response('{}');
    });
    await send('hello');
    const p = posts(calls);
    expect(p).toHaveLength(2);
    expect(authOf(p[0]!)).toBe('Visitor old');
    expect(authOf(p[1]!)).toBeUndefined();
    expect(localStorage.getItem('rapiz_v_abc')).toBe('fresh');
  });

  it('429 shows the rate limit notice and does not retry', async () => {
    const { calls, root, send } = await mount(
      () => new Response('{}', { status: 429, headers: { 'Retry-After': '5' } }),
    );
    await send('hello');
    await vi.advanceTimersByTimeAsync(20000);
    expect(posts(calls)).toHaveLength(1);
    expect(root.querySelector('.notice')?.textContent).toContain('nhanh');
  });

  it('retries 5xx and network errors with the same clientMessageId', async () => {
    let n = 0;
    const { calls, send, settle } = await mount((_u, init) => {
      if (_u.endsWith('/messages') && init?.method !== 'POST')
        return new Response(JSON.stringify(empty));
      n++;
      if (n === 1) return new Response('{}', { status: 503 });
      if (n === 2) throw new TypeError('offline');
      return echo(init);
    });
    await send('hello');
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    await vi.advanceTimersByTimeAsync(4000);
    await settle();
    const ids = posts(calls).map(
      (c) => (JSON.parse(String(c.init?.body)) as { clientMessageId: string }).clientMessageId,
    );
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  it('409 PHONE_REQUIRED holds the message, then releases it after the phone is saved', async () => {
    localStorage.setItem('rapiz_v_abc', 'tok');
    let required = true;
    const { calls, root, send, settle } = await mount((url, init) => {
      if (url.endsWith('/phone')) return new Response(JSON.stringify({ phoneCaptured: true }));
      if (init?.method === 'POST') {
        return required
          ? new Response(JSON.stringify({ error: 'PHONE_REQUIRED' }), { status: 409 })
          : echo(init);
      }
      return new Response(JSON.stringify(empty));
    });
    await send('hello');
    expect(root.querySelector<HTMLElement>('form.phoneform')!.hidden).toBe(false);
    expect(posts(calls)).toHaveLength(1);
    required = false;
    root.querySelector<HTMLInputElement>('input[type=tel]')!.value = '0912345678';
    root
      .querySelector<HTMLFormElement>('form.phoneform')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const p = posts(calls);
    expect(p).toHaveLength(2);
    const id = (c: (typeof p)[number]) =>
      (JSON.parse(String(c.init?.body)) as { clientMessageId: string }).clientMessageId;
    expect(id(p[1]!)).toBe(id(p[0]!));
    expect(root.querySelector<HTMLElement>('form.composer')!.hidden).toBe(false);
  });

  it('a poll with phoneRequired switches to the phone input', async () => {
    localStorage.setItem('rapiz_v_abc', 'tok');
    const { root, settle } = await mount(
      () => new Response(JSON.stringify({ ...empty, phoneRequired: true })),
    );
    await settle();
    expect(root.querySelector<HTMLElement>('form.phoneform')!.hidden).toBe(false);
  });

  it('restores history of a returning visitor without a badge', async () => {
    localStorage.setItem('rapiz_v_abc', 'tok');
    const { root, settle } = await mount(
      () =>
        new Response(
          JSON.stringify({
            ...empty,
            messages: [
              {
                id: 'a1',
                role: 'agent',
                text: 'old reply',
                imageUrl: null,
                at: '2026-10-27T09:00:00.000Z',
              },
            ],
          }),
        ),
    );
    await settle();
    expect(root.textContent).toContain('old reply');
    expect(root.querySelector<HTMLElement>('.badge')!.hidden).toBe(true);
  });
});
