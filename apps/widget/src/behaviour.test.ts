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

  async function mount(handler: Handler, starters?: string) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url) === base) return Promise.resolve(new Response(JSON.stringify(config)));
        return Promise.resolve(handler(String(url), init));
      }),
    );
    const tag = script('https://cdn.example/widget.js?key=abc');
    if (starters) tag.setAttribute('data-starters', starters);
    await boot(tag);
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
      if (url.endsWith('/contact')) return new Response(JSON.stringify({ captured: 'phone' }));
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
    const contact = root.querySelector<HTMLInputElement>('form.phoneform input[inputmode=tel]')!;
    expect(contact.placeholder).toBe('Số điện thoại của bạn');
    contact.value = '0912345678';
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

  it('offers the starter questions under the greeting of a new conversation only', async () => {
    const { root, calls, settle } = await mount(
      (_u, init) => (init?.method === 'POST' ? echo(init) : new Response(JSON.stringify(empty))),
      'Xem bảng giá| |Đặt lịch demo',
    );
    root.querySelector<HTMLElement>('.bubble')!.click();
    const pills = [...root.querySelectorAll<HTMLElement>('.sugg .sg')];
    expect(pills.map((b) => b.textContent)).toEqual(['Xem bảng giá', 'Đặt lịch demo']);
    pills[0]!.click();
    await settle();
    const sent = posts(calls).map(
      (c) => (JSON.parse(String(c.init?.body)) as { text: string }).text,
    );
    expect(sent).toEqual(['Xem bảng giá']);
    expect(root.querySelector('.sugg')).toBeNull();
  });

  it('sends only some text, and says when the device is offline', async () => {
    const { root } = await mount(() => new Response(JSON.stringify(empty)));
    const input = root.querySelector<HTMLTextAreaElement>('textarea')!;
    const sendButton = root.querySelector<HTMLButtonElement>('form.composer .send')!;
    expect(sendButton.disabled).toBe(true);
    input.value = 'chào';
    input.dispatchEvent(new Event('input'));
    expect(sendButton.disabled).toBe(false);
    window.dispatchEvent(new Event('offline'));
    expect(root.querySelector<HTMLElement>('.notice')!.hidden).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(root.querySelector<HTMLElement>('.notice')!.hidden).toBe(true);
  });

  describe('rich messages (ADR-029)', () => {
    const rich = {
      id: 'a1',
      role: 'agent',
      text: 'Dạ có 2 gói ạ',
      imageUrl: null,
      clientMessageId: null,
      at: '2026-10-27T09:00:00.000Z',
      ui: {
        cards: [
          {
            productId: 'p1',
            title: 'Gói Basic',
            price: '200.000đ',
            imageUrl: 'https://img.example/b.jpg',
          },
          { productId: 'p2', title: 'Gói Pro', price: 'Từ 400.000đ', imageUrl: null },
        ],
        suggestions: [
          { kind: 'reply', text: 'Gói Pro có gì?' },
          { kind: 'link', title: 'Xem bảng giá', url: 'http://localhost:3000/#pricing' },
          { kind: 'link', title: 'Liên hệ', url: 'http://localhost:3000/lien-he' },
        ],
      },
    };
    const sentTexts = (calls: { url: string; init: RequestInit | undefined }[]) =>
      posts(calls).map((c) => (JSON.parse(String(c.init?.body)) as { text?: string }).text);

    async function richMount(route?: (url: string) => Response | null) {
      localStorage.setItem('rapiz_v_abc', 'tok');
      let answered = false;
      const env = await mount((url, init) => {
        const routed = route?.(url);
        if (routed) return routed;
        if (init?.method === 'POST') {
          answered = true;
          return echo(init);
        }
        return new Response(JSON.stringify({ ...empty, messages: answered ? [] : [rich] }));
      });
      await env.settle();
      env.root.querySelector<HTMLElement>('.bubble')!.click();
      await env.settle();
      return env;
    }

    it('shows the product cards and the next steps under the newest answer', async () => {
      const { root } = await richMount();
      const cards = [...root.querySelectorAll('.card')].map((c) => c.textContent);
      expect(cards).toEqual([
        expect.stringContaining('Gói Basic200.000đTìm hiểu thêm'),
        expect.stringContaining('Gói ProTừ 400.000đ'),
      ]);
      expect(root.querySelector('.card .pic')?.getAttribute('data-initial')).toBe('G');
      expect([...root.querySelectorAll('.sg')].map((b) => [b.textContent, b.className])).toEqual([
        ['Gói Pro có gì?', 'sg reply'],
        ['Xem bảng giá', 'sg link down'],
        ['Liên hệ', 'sg link'],
      ]);
    });

    it('a card asks about its product; a reply is sent as the visitor and the buttons go', async () => {
      const { root, calls, settle } = await richMount();
      root.querySelectorAll<HTMLElement>('.card')[1]!.click();
      await settle();
      expect(sentTexts(calls)).toEqual(['Cho mình tìm hiểu thêm về Gói Pro']);
      expect(root.querySelector('.sugg')).toBeNull();
    });

    it('offers the phone chip under the header; the phone form closes back to it', async () => {
      const { root, settle } = await richMount();
      const chip = root.querySelector<HTMLElement>('.head + .lead > .chip')!;
      expect(chip.hidden).toBe(false);
      expect(chip.textContent).toBe('Để lại SĐT');
      chip.click();
      await settle();
      const form = root.querySelector<HTMLElement>('form.phoneform')!;
      expect(form.hidden).toBe(false);
      expect(root.querySelector<HTMLElement>('form.composer')!.hidden).toBe(true);
      expect(form.querySelector('.phead .hint')?.textContent).toBe('Để lại số điện thoại?');
      expect(form.querySelector('.field button[type=submit]')?.getAttribute('aria-label')).toBe(
        'Gửi số',
      );
      form.querySelector<HTMLElement>('.phead button[aria-label="Quay lại"]')!.click();
      await settle();
      expect(form.hidden).toBe(true);
      expect(chip.hidden).toBe(false);
    });

    it('the lead form takes a name and an email; the chip goes once it is saved', async () => {
      const { root, calls, settle } = await richMount((url) =>
        url.endsWith('/contact') ? new Response(JSON.stringify({ captured: 'email' })) : null,
      );
      root.querySelector<HTMLElement>('.lead > .chip')!.click();
      await settle();
      const form = root.querySelector<HTMLFormElement>('form.phoneform')!;
      const [name, contact] = [...form.querySelectorAll<HTMLInputElement>('input')];
      expect(name!.placeholder).toBe('Tên của bạn (không bắt buộc)');
      expect(contact!.placeholder).toBe('Số điện thoại hoặc email');
      contact!.value = 'lan@';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(form.querySelector('.err')?.textContent).toBe(
        'Số điện thoại hoặc email chưa đúng, vui lòng kiểm tra lại.',
      );
      name!.value = '  Lan  Nguyễn ';
      contact!.value = ' lan@shop.vn ';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      const sent = calls.filter((c) => c.url.endsWith('/contact'));
      expect(sent.map((c) => JSON.parse(String(c.init?.body)))).toEqual([
        { contact: 'lan@shop.vn', name: 'Lan Nguyễn' },
      ]);
      expect(form.hidden).toBe(true);
      expect(root.querySelector<HTMLElement>('.lead > .chip')!.hidden).toBe(true);
    });

    it('draws a card with a summary as a plan card, the recommended one featured', async () => {
      localStorage.setItem('rapiz_v_abc', 'tok');
      const plans = {
        ...rich,
        ui: {
          cards: [
            { productId: 'p1', title: 'Miễn phí', price: '0đ', imageUrl: null, summary: 'Thử.' },
            {
              productId: 'p2',
              title: 'Sales Smart',
              price: '785.000đ / tháng',
              imageUrl: 'https://img.example/s.jpg',
              summary: 'Đội sale nhỏ.',
              highlights: ['5 thành viên', '5 kênh'],
              recommended: true,
            },
          ],
        },
      };
      const { root, settle } = await mount(
        () => new Response(JSON.stringify({ ...empty, messages: [plans] })),
      );
      await settle();
      root.querySelector<HTMLElement>('.bubble')!.click();
      await settle();
      const cards = [...root.querySelectorAll<HTMLElement>('.card')];
      expect(cards.map((c) => c.className)).toEqual(['card plan', 'card plan rec']);
      expect(cards[1]!.textContent).toBe(
        'Sales SmartĐội sale nhỏ.785.000đ / tháng5 thành viên5 kênhTìm hiểu thêm',
      );
      expect(root.querySelector('.card img')).toBeNull();
    });

    it('a reply suggestion is sent as typed', async () => {
      const { root, calls, settle } = await richMount();
      root.querySelector<HTMLElement>('.sg.reply')!.click();
      await settle();
      expect(sentTexts(calls)).toEqual(['Gói Pro có gì?']);
    });

    it('a section of this page scrolls into view; another page keeps the chat open there', async () => {
      const section = document.createElement('section');
      section.setAttribute('data-rapiz-section', 'pricing');
      section.scrollIntoView = vi.fn();
      document.body.appendChild(section);
      const { root } = await richMount();
      root.querySelector<HTMLElement>('.sg.down')!.click();
      expect(section.scrollIntoView).toHaveBeenCalled();
      expect(localStorage.getItem('rapiz_reopen_abc')).toBeNull();
      root.querySelectorAll<HTMLElement>('.sg.link')[1]!.click();
      expect(Number(localStorage.getItem('rapiz_reopen_abc'))).toBeGreaterThan(0);
    });

    it('sends the places of the page with each message', async () => {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<nav><a href="/bang-gia?x=1">Bảng giá</a></nav><section id="faq"><h2>Câu hỏi</h2></section>',
      );
      const { calls, send } = await mount((_u, init) =>
        init?.method === 'POST' ? echo(init) : new Response(JSON.stringify(empty)),
      );
      await send('hello');
      const page = (JSON.parse(String(posts(calls)[0]?.init?.body)) as { page: { nav: unknown } })
        .page;
      expect(page.nav).toEqual([
        { label: 'Câu hỏi', url: 'http://localhost:3000/#faq' },
        { label: 'Bảng giá', url: 'http://localhost:3000/bang-gia' },
      ]);
    });
  });
});
