import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { RulesList } from './rules-list';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00';
const list = `GET /bots/${BOT}/training-items`;
let n = 0;
function rule(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b${String(n).padStart(2, '0')}`,
    botId: BOT,
    kind: 'scenario',
    title: `Rule ${n}`,
    content: `Content ${n}`,
    trigger: '',
    mediaUrl: null,
    folderId: null,
    enabled: true,
    section: 'general',
    createdAt: `2026-10-0${n}T00:00:00.000Z`,
    updatedAt: `2026-10-0${n}T00:00:00.000Z`,
    ...over,
  };
}

async function setup(
  data: unknown[],
  extra: Record<string, { status: number; body?: unknown }> = {},
) {
  const stub = stubFetch({ [list]: { status: 200, body: { data } }, ...extra });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <RulesList botId={BOT} introduction={<p>intro-row</p>} />);
  await screen.findByRole('heading', { name: 'Hướng dẫn trả lời' }, { timeout: 10_000 });
  return stub;
}

const group = (name: string) => screen.getByRole('region', { name });

describe('RulesList', () => {
  it('groups rules by section in order and numbers each group from 1', async () => {
    n = 0;
    await setup([
      rule({ title: 'A' }),
      rule({ title: 'B', section: 'after_order' }),
      rule({ title: 'C' }),
    ]);
    await screen.findByText('A');
    const names = screen
      .getAllByRole('region')
      .map((el) => el.getAttribute('aria-label'))
      .filter(Boolean);
    expect(names).toEqual(['Tình huống', 'Chung', 'Sau khi chốt đơn', 'Hệ thống']);
    const general = within(group('Chung')).getAllByRole('listitem');
    expect(general).toHaveLength(2);
    expect(within(general[0]!).getByText('1')).toBeInTheDocument();
    expect(within(general[1]!).getByText('2')).toBeInTheDocument();
    expect(within(group('Sau khi chốt đơn')).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('intro-row')).toBeInTheDocument();
  });

  it('toggles a rule with a PATCH of { enabled }', async () => {
    n = 0;
    const r = rule({ title: 'Toggle me' });
    const { calls } = await setup([r], {
      [`PATCH /bots/${BOT}/training-items/${r.id}`]: {
        status: 200,
        body: { ...r, enabled: false },
      },
    });
    await userEvent.click(await screen.findByRole('switch', { name: /Toggle me/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({ enabled: false }),
    );
  });

  it('dims a disabled rule and exposes the switch state', async () => {
    n = 0;
    await setup([rule({ title: 'Off rule', enabled: false })]);
    const sw = await screen.findByRole('switch', { name: /Off rule/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    const row = sw.closest('li');
    expect(row).toHaveAttribute('data-enabled', 'false');
    expect(within(row as HTMLElement).getByRole('button', { name: /Off rule/ })).toHaveClass(
      'opacity-50',
    );
  });

  it('duplicates a rule as a new item with the same content and section', async () => {
    n = 0;
    const r = rule({ title: 'Original', content: 'Same body', section: 'after_order' });
    const { calls } = await setup([r], {
      [`POST /bots/${BOT}/training-items`]: { status: 201, body: rule() },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Nhân bản' }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('POST'))).toBe(true));
    expect(calls.find((c) => c.key.startsWith('POST'))?.body).toMatchObject({
      kind: 'scenario',
      content: 'Same body',
      section: 'after_order',
      title: 'Original (bản sao)',
    });
  });

  it('disables the copy buttons while a save is pending', async () => {
    n = 0;
    const r = rule({ title: 'Original' });
    const stub = stubFetch({
      [list]: { status: 200, body: { data: [r] } },
      [`POST /bots/${BOT}/training-items`]: { status: 201, body: rule() },
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      if (init.method === 'POST') await gate;
      return stub.fetchStub(input, init);
    });
    renderWithRouter(() => <RulesList botId={BOT} />);
    const button = await screen.findByRole('button', { name: 'Nhân bản' }, { timeout: 10_000 });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await userEvent.click(button);
    release();
    await waitFor(() => expect(button).toBeEnabled());
    expect(stub.calls.filter((c) => c.key.startsWith('POST'))).toHaveLength(1);
  });

  const many = (count: number, disabled: number) =>
    Array.from({ length: count }, (_, i) =>
      rule({
        enabled: i >= disabled,
        createdAt: `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`,
        updatedAt: `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      }),
    );

  it('hides the enabled-rule counter below 15 enabled rules', async () => {
    n = 0;
    await setup(many(16, 2));
    await screen.findByText('Rule 1', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('rules-counter')).toBeNull();
  }, 20_000);

  it('shows how many of the 20 rules are enabled from 15 on', async () => {
    n = 0;
    await setup(many(17, 1));
    expect(await screen.findByTestId('rules-counter', {}, { timeout: 10_000 })).toHaveTextContent(
      '16/20 đang bật',
    );
  }, 20_000);

  it('creates a rule in the chosen section', async () => {
    n = 0;
    const { calls } = await setup([], {
      [`POST /bots/${BOT}/training-items`]: { status: 201, body: rule() },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm tình huống' }));
    await userEvent.type(await screen.findByLabelText('Tiêu đề'), 'Thanks');
    await userEvent.type(screen.getByLabelText(/Nội dung/), 'Say thanks');
    await userEvent.click(screen.getByRole('combobox', { name: 'Nhóm quy tắc' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Sau khi chốt đơn' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('POST'))).toBe(true));
    expect(calls.find((c) => c.key.startsWith('POST'))?.body).toMatchObject({
      title: 'Thanks',
      section: 'after_order',
    });
  });

  it('filters rules by search text and hides empty groups', async () => {
    n = 0;
    await setup([
      rule({ title: 'Refund policy' }),
      rule({ title: 'Greeting', section: 'after_order' }),
    ]);
    await screen.findByText('Refund policy');
    await userEvent.type(screen.getByLabelText('Tìm kiếm tình huống'), 'refund');
    expect(screen.queryByText('Greeting')).not.toBeInTheDocument();
    expect(screen.getByText('Refund policy')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sau khi chốt đơn' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Tìm kiếm tình huống'));
    await userEvent.type(screen.getByLabelText('Tìm kiếm tình huống'), 'zzz');
    expect(screen.getByText('Không có tình huống phù hợp')).toBeInTheDocument();
  });

  it('collapses the system rules by default and expands them on demand', async () => {
    n = 0;
    await setup([rule()]);
    await screen.findByText('Rule 1', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('system-rules')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Hệ thống/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('system-rules')).toBeInTheDocument();
  });

  it('reads each situation as "Khi khách … → Bot sẽ …" and keeps the title as its label', async () => {
    n = 0;
    await setup([
      rule({
        title: 'Hỏi giá',
        trigger: 'Khách hỏi giá sản phẩm',
        content: 'Báo giá trong dữ liệu',
      }),
    ]);
    const row = (
      await screen.findByRole('heading', { name: 'Hỏi giá' }, { timeout: 10_000 })
    ).closest('li')!;
    expect(within(row).getByText('Khi khách hỏi giá sản phẩm')).toBeInTheDocument();
    expect(within(row).getByText('Bot sẽ báo giá trong dữ liệu')).toBeInTheDocument();
  });

  it('hides the "Khi khách" line when the trigger is only the prefix', async () => {
    n = 0;
    await setup([
      rule({ title: 'Chỉ Khách', trigger: 'Khách' }),
      rule({ title: 'Chỉ Khi', trigger: 'Khi' }),
      rule({ title: 'Chỉ Khi khách', trigger: 'Khi khách' }),
    ]);
    await screen.findByRole('heading', { name: 'Chỉ Khách' }, { timeout: 10_000 });
    expect(screen.queryByText(/^Khi khách/)).not.toBeInTheDocument();
  });

  it('shows the locked system group without any action buttons', async () => {
    n = 0;
    await setup([rule()]);
    await screen.findByText('Rule 1', {}, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: /Hệ thống/ }));
    const system = screen.getByTestId('system-rules');
    expect(within(system).getAllByRole('listitem')).toHaveLength(5);
    expect(within(system).queryAllByRole('button')).toHaveLength(0);
    expect(within(system).queryAllByRole('switch')).toHaveLength(0);
    expect(within(system).getByText(/không bao giờ tiết lộ/i)).toBeInTheDocument();
  });

  it('adds the starter set, refreshes the list and reports the count', async () => {
    n = 0;
    const created = [rule({ title: 'Starter 1' }), rule({ title: 'Starter 2' })];
    const stub = stubFetch({
      [list]: { status: 200, body: { data: [] } },
      [`POST /bots/${BOT}/training-items/starter-rules`]: { status: 201, body: { data: created } },
    });
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <RulesList botId={BOT} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Gợi ý theo ngành' }, { timeout: 10_000 }),
    );
    await waitFor(() =>
      expect(stub.calls.filter((c) => c.key === list).length).toBeGreaterThanOrEqual(2),
    );
    expect(stub.calls.some((c) => c.key.endsWith('/starter-rules'))).toBe(true);
  });
});
