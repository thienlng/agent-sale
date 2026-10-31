import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { TestChat } from './test-chat';

const botId = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d11';
const reply = {
  runId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d12',
  reply: 'Dạ shop ở 12 Lê Lợi ạ',
  outcome: 'answered',
  guardrail: null,
  images: [],
  sources: [
    {
      faqId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d13',
      question: 'Cửa hàng ở đâu?',
      score: 0.8,
      used: true,
    },
  ],
  usage: { inputTokens: 40, outputTokens: 12, cachedInputTokens: 0 },
  provider: 'dev-fake',
  model: 'grounded-echo',
  latencyMs: 420,
};

beforeAll(() => {
  // jsdom lacks these; the message scroller uses them for auto-scroll.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollTo ??= () => {};
  URL.createObjectURL ??= () => `blob:test/${Math.random()}`;
  URL.revokeObjectURL ??= () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe('TestChat', () => {
  it('sends the greeting + customer turn and shows the reply with its source', async () => {
    const { fetchStub, calls } = stubFetch({
      [`POST /bots/${botId}/playground`]: { status: 200, body: reply },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="Dạ Shop Lan xin chào ạ!" />);

    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'shop o dau vay{Enter}');

    expect(await screen.findByText('Dạ shop ở 12 Lê Lợi ạ')).toBeInTheDocument();
    expect(screen.getByText('Trả lời từ FAQ: Cửa hàng ở đâu?')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({
      messages: [
        { role: 'bot', content: 'Dạ Shop Lan xin chào ạ!' },
        { role: 'customer', content: 'shop o dau vay' },
      ],
    });
  });

  it('shows a bot answer as the same bubbles Messenger receives', async () => {
    const answer = {
      ...reply,
      reply: 'Dạ bộ này giá 340.000đ ạ.\nBé mấy tuổi rồi ạ? Em tư vấn thêm nhé.',
    };
    const { fetchStub } = stubFetch({
      [`POST /bots/${botId}/playground`]: { status: 200, body: answer },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="Dạ Shop Lan xin chào ạ!" />);

    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'gia sao{Enter}');

    for (const bubble of ['Dạ bộ này giá 340.000đ ạ.', 'Bé mấy tuổi rồi ạ?', 'Em tư vấn thêm nhé.'])
      expect(await screen.findByText(bubble)).toBeInTheDocument();
  });

  it('explains a missing AI configuration instead of failing silently', async () => {
    const { fetchStub } = stubFetch({
      [`POST /bots/${botId}/playground`]: {
        status: 503,
        body: {
          error: { code: 'AI_UNAVAILABLE', message: 'No AI model is configured for this tier' },
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <TestChat botId={botId} greeting="" suggestions={['Phí ship bao nhiêu?']} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Phí ship bao nhiêu?' }));
    expect(
      await screen.findByText('Chưa cấu hình mô hình AI cho gói này. Liên hệ quản trị hệ thống.'),
    ).toBeInTheDocument();
  });

  it('offers the FAQ starters only while empty and resets the conversation', async () => {
    const { fetchStub } = stubFetch({
      [`POST /bots/${botId}/playground`]: { status: 200, body: reply },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <TestChat botId={botId} greeting="" suggestions={['Cửa hàng ở đâu?', 'Giờ mở cửa?']} />,
    );
    expect(
      screen.getByText('Xem cách Bot phản hồi những câu hỏi thường gặp này'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cửa hàng ở đâu?' }));
    expect(await screen.findByText('Dạ shop ở 12 Lê Lợi ạ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Giờ mở cửa?' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Làm mới đoạn chat' }));
    expect(screen.queryByText('Dạ shop ở 12 Lê Lợi ạ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Giờ mở cửa?' })).toBeInTheDocument();
  });

  describe('images', () => {
    const png = (name = 'a.png', type = 'image/png', size = 4) =>
      new File([new Uint8Array(size)], name, { type });
    const setup = (body: unknown = reply) => {
      const { fetchStub, calls } = stubFetch({
        [`POST /bots/${botId}/playground`]: { status: 200, body },
      });
      vi.stubGlobal('fetch', fetchStub);
      renderWithProviders(<TestChat botId={botId} greeting="" />);
      return { calls, input: screen.getByTestId('test-chat-file') };
    };

    it('sends an attached image as base64 with its thumbnail kept in the bubble', async () => {
      const { calls, input } = setup();
      await userEvent.upload(input, png());
      expect(screen.getByAltText('Ảnh đính kèm')).toBeInTheDocument();
      await userEvent.type(
        screen.getByLabelText('Nhập tin nhắn của bạn'),
        'giay nay gia sao{Enter}',
      );
      expect(await screen.findByText('Dạ shop ở 12 Lê Lợi ạ')).toBeInTheDocument();
      expect(calls[0]?.body).toEqual({
        messages: [{ role: 'customer', content: 'giay nay gia sao' }],
        images: [{ mimeType: 'image/png', base64: 'AAAAAA==' }],
      });
      expect(screen.getAllByAltText('Ảnh đính kèm')).toHaveLength(1);
    });

    it('sends an image-only message and does not resend it on the next turn', async () => {
      const { calls, input } = setup();
      await userEvent.upload(input, png());
      await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
      await screen.findByText('Dạ shop ở 12 Lê Lợi ạ');
      await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'cam on{Enter}');
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[0]?.body).toHaveProperty('images');
      expect(calls[1]?.body).not.toHaveProperty('images');
    });

    it('sends no images field for a text-only message', async () => {
      const { calls } = setup();
      await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'xin chao{Enter}');
      await screen.findByText('Dạ shop ở 12 Lê Lợi ạ');
      expect(calls[0]?.body).not.toHaveProperty('images');
    });

    it('lets the owner remove a pending image', async () => {
      const { input } = setup();
      await userEvent.upload(input, png());
      await userEvent.click(screen.getByRole('button', { name: 'Bỏ ảnh này' }));
      expect(screen.queryByAltText('Ảnh đính kèm')).not.toBeInTheDocument();
    });

    it('rejects more than 3 images, oversized files and other types', async () => {
      const { input } = setup();
      await userEvent.upload(input, [png('1.png'), png('2.png'), png('3.png')]);
      await userEvent.upload(input, png('4.png'));
      expect(screen.getByRole('alert')).toHaveTextContent('tối đa 3 ảnh');
      expect(screen.getAllByAltText('Ảnh đính kèm')).toHaveLength(3);

      await userEvent.click(screen.getAllByRole('button', { name: 'Bỏ ảnh này' })[0]!);
      fireEvent.change(input, {
        target: { files: [png('big.png', 'image/png', 3 * 1024 * 1024 + 1)] },
      });
      expect(screen.getByRole('alert')).toHaveTextContent('tối đa 3 MB');
      fireEvent.change(input, { target: { files: [png('x.gif', 'image/gif')] } });
      expect(screen.getByRole('alert')).toHaveTextContent('JPEG, PNG hoặc WebP');
      expect(screen.getAllByAltText('Ảnh đính kèm')).toHaveLength(2);
    });

    it('renders the pictures the bot sends and falls back to the label when broken', async () => {
      setup({
        ...reply,
        images: [{ url: 'https://cdn.shop.vn/giay.jpg', label: 'Giày Oxford' }],
      });
      await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'cho xem anh{Enter}');
      const img = await screen.findByAltText('Giày Oxford');
      const link = img.closest('a');
      expect(link).toHaveAttribute('href', 'https://cdn.shop.vn/giay.jpg');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(img).toHaveAttribute('loading', 'lazy');
      expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
      fireEvent.error(img);
      expect(screen.getByRole('link', { name: 'Giày Oxford' })).toBeInTheDocument();
    });

    it('clears images and revokes object URLs on reset', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      const { input } = setup();
      await userEvent.upload(input, png());
      await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
      await screen.findByText('Dạ shop ở 12 Lê Lợi ạ');
      await userEvent.click(screen.getByRole('button', { name: 'Làm mới đoạn chat' }));
      expect(screen.queryByAltText('Ảnh đính kèm')).not.toBeInTheDocument();
      expect(revoke).toHaveBeenCalled();
      expect(
        screen.getByText('Bạn có thể gửi ảnh để thử bot nhận diện sản phẩm'),
      ).toBeInTheDocument();
    });

    it('explains an image error from a provider without vision', async () => {
      const { fetchStub } = stubFetch({
        [`POST /bots/${botId}/playground`]: {
          status: 500,
          body: {
            error: { code: 'INTERNAL', message: 'anthropic provider: images are not supported' },
          },
        },
      });
      vi.stubGlobal('fetch', fetchStub);
      renderWithProviders(<TestChat botId={botId} greeting="" />);
      await userEvent.upload(screen.getByTestId('test-chat-file'), png());
      await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
      expect(await screen.findByText(/chưa đọc được ảnh/)).toBeInTheDocument();
    });
  });

  describe('agent messages and steps', () => {
    const send = async (body: unknown) => {
      const { fetchStub } = stubFetch({
        [`POST /bots/${botId}/playground`]: { status: 200, body },
      });
      vi.stubGlobal('fetch', fetchStub);
      renderWithProviders(<TestChat botId={botId} greeting="" />);
      await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'cho xem mau{Enter}');
    };
    const twoMessages = {
      ...reply,
      reply: 'Dạ mẫu A giá 200k ạ.\nDạ mẫu B giá 300k ạ.',
      images: [
        { url: 'https://cdn.shop.vn/a.jpg', label: 'Mẫu A' },
        { url: 'https://cdn.shop.vn/b.jpg', label: 'Mẫu B' },
      ],
      messages: [
        {
          text: 'Dạ mẫu A giá 200k ạ.',
          images: [{ id: 'img-a', url: 'https://cdn.shop.vn/a.jpg', label: 'Mẫu A' }],
          via: 'send_message',
        },
        {
          text: 'Dạ mẫu B giá 300k ạ.',
          images: [{ id: 'img-b', url: 'https://cdn.shop.vn/b.jpg', label: 'Mẫu B' }],
          via: 'final',
        },
      ],
      steps: [
        { kind: 'model', ms: 812 },
        { kind: 'tool', name: 'search_products', ok: true, ms: 34 },
        { kind: 'tool', name: 'send_message', ok: false, ms: 5 },
      ],
    };

    it('renders each message in order with its own album under it', async () => {
      await send(twoMessages);
      const textA = await screen.findByText('Dạ mẫu A giá 200k ạ.');
      const textB = screen.getByText('Dạ mẫu B giá 300k ạ.');
      const imgA = screen.getByAltText('Mẫu A');
      const imgB = screen.getByAltText('Mẫu B');
      // Each picture once (no second copy from the joined `images` view).
      expect(screen.getAllByAltText('Mẫu A')).toHaveLength(1);
      expect(screen.getAllByAltText('Mẫu B')).toHaveLength(1);
      const order = [textA, imgA, textB, imgB];
      for (let i = 1; i < order.length; i++)
        expect(
          order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('keeps the steps collapsed until the owner opens them', async () => {
      await send(twoMessages);
      const toggle = await screen.findByRole('button', { name: /Các bước bot đã làm/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('search_products')).not.toBeInTheDocument();

      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('search_products')).toBeInTheDocument();
      expect(screen.getByText('send_message')).toBeInTheDocument();
      expect(screen.getByText('812 ms')).toBeInTheDocument();
      expect(screen.getByText('lỗi')).toBeInTheDocument();

      await userEvent.click(toggle);
      expect(screen.queryByText('search_products')).not.toBeInTheDocument();
    });

    it('notes a turn that a newer customer message cut short', async () => {
      await send({ ...twoMessages, interrupted: true });
      expect(
        await screen.findByText('Khách vừa nhắn thêm nên bot dừng lượt này giữa chừng'),
      ).toBeInTheDocument();
    });

    it('still renders a legacy response without messages or steps', async () => {
      await send({
        ...reply,
        reply: 'Dạ có ạ.\nChị xem ảnh nhé.',
        images: [{ url: 'https://cdn.shop.vn/c.jpg', label: 'Mẫu C' }],
      });
      expect(await screen.findByText('Dạ có ạ.')).toBeInTheDocument();
      expect(screen.getByText('Chị xem ảnh nhé.')).toBeInTheDocument();
      expect(screen.getByAltText('Mẫu C')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Các bước bot đã làm/ })).not.toBeInTheDocument();
    });
  });

  it('shows a chip per API action the bot called', async () => {
    const { fetchStub } = stubFetch({
      [`POST /bots/${botId}/playground`]: {
        status: 200,
        body: {
          ...reply,
          actions: [
            { name: 'Tra cứu đơn', ok: true, statusCode: 200 },
            { name: 'Đặt lịch', ok: false, statusCode: null },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<TestChat botId={botId} greeting="Xin chào" />);
    await userEvent.type(screen.getByLabelText('Nhập tin nhắn của bạn'), 'don cua toi{Enter}');
    expect(await screen.findByText('Đã gọi API: Tra cứu đơn')).toBeInTheDocument();
    expect(screen.getByText('Gọi API lỗi: Đặt lịch')).toBeInTheDocument();
  });
});
