import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot } from './index.js';

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

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('boot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    delete (window as { __rapizWidget?: unknown }).__rapizWidget;
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing when the config request returns 404', async () => {
    const fetchMock = vi.fn((_url: string) => json(404, { error: 'NOT_FOUND' }));
    vi.stubGlobal('fetch', fetchMock);
    await boot(script('https://cdn.example/widget.js?key=abc'));
    expect(document.querySelector('[data-rapiz-widget]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://cdn.example/api/v1/webchat/v1/sites/abc',
    );
  });

  it('renders a shadow host with the bubble on 200 and uses data-api', async () => {
    const fetchMock = vi.fn((_url: string) => json(200, config));
    vi.stubGlobal('fetch', fetchMock);
    await boot(script('https://cdn.example/widget.js?key=abc', 'http://localhost:3000'));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://localhost:3000/api/v1/webchat/v1/sites/abc',
    );
    const host = document.querySelector<HTMLElement>('[data-rapiz-widget]');
    expect(host).not.toBeNull();
    expect(host?.style.position).toBe('fixed');
    expect(host?.style.zIndex).toBe('2147483000');
    expect(host?.shadowRoot?.querySelector('.bubble')).not.toBeNull();
  });

  it('renders with defaults on a network error and on 5xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await boot(script('https://cdn.example/widget.js?key=abc'));
    expect(document.querySelector('[data-rapiz-widget]')).not.toBeNull();
    document.body.innerHTML = '';
    delete (window as { __rapizWidget?: unknown }).__rapizWidget;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json(503, {})),
    );
    await boot(script('https://cdn.example/widget.js?key=abc'));
    expect(document.querySelector('[data-rapiz-widget]')).not.toBeNull();
  });

  it('guards against double inclusion', async () => {
    const fetchMock = vi.fn(() => json(200, config));
    vi.stubGlobal('fetch', fetchMock);
    const s = script('https://cdn.example/widget.js?key=abc');
    await boot(s);
    await boot(s);
    expect(document.querySelectorAll('[data-rapiz-widget]')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a key', async () => {
    const fetchMock = vi.fn(() => json(200, config));
    vi.stubGlobal('fetch', fetchMock);
    await boot(script('https://cdn.example/widget.js'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a message with a visitor token flow and shows the pending bubble', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { clientMessageId: string };
          return json(202, {
            visitorToken: 'tok',
            message: {
              id: body.clientMessageId,
              role: 'customer',
              text: 'hello',
              imageUrl: null,
              at: '2026-10-27T10:00:00.000Z',
            },
          });
        }
        if (String(url).includes('/messages')) {
          return json(200, {
            messages: [],
            botTyping: true,
            phoneCaptured: false,
            phoneRequired: false,
          });
        }
        return json(200, config);
      }),
    );
    await boot(script('https://cdn.example/widget.js?key=abc'));
    const root = document.querySelector<HTMLElement>('[data-rapiz-widget]')!.shadowRoot!;
    root.querySelector<HTMLElement>('.bubble')!.click();
    const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = 'hello';
    root
      .querySelector<HTMLFormElement>('form.composer')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(localStorage.getItem('rapiz_v_abc')).toBe('tok'));
    const post = calls.find((c) => c.init?.method === 'POST')!;
    const body = JSON.parse(String(post.init!.body)) as Record<string, unknown>;
    expect(body.text).toBe('hello');
    expect(body.seen).toEqual(['Xin chào!']);
    expect(post.url).toBe('https://cdn.example/api/v1/webchat/v1/sites/abc/messages');
    expect(root.textContent).toContain('hello');
  });
});
