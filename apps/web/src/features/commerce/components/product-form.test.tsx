import type { ProductDto } from '@agent-sales/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectPageContext, fillAssistantForm } from '@/lib/assistant-context';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { ProductForm } from './product-form';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

const ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01';
const WAREHOUSE = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const product = (linked: boolean): ProductDto => ({
  id: ID,
  code: 'SM01',
  name: 'Sơ mi trắng',
  description: 'Vải cotton',
  category: 'Áo',
  status: 'active',
  visibleToBot: true,
  botInstructions: '',
  imageUrls: ['https://cdn.example.com/a.jpg'],
  offering: null,
  variants: [
    {
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01',
      sku: 'SM01-M',
      name: 'Size M',
      price: 250_000,
      cost: 120_000,
      weightGram: 300,
      stock: [{ warehouseId: WAREHOUSE, onHand: 7, reserved: 1, available: 6 }],
    },
  ],
  external: linked ? { source: 'kiotviet', id: '9001' } : null,
  priceMin: 250_000,
  priceMax: 250_000,
  available: 6,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

function setup(p: ProductDto, pmsLink: { retailer: string; lastSyncAt: string | null } | null) {
  const { fetchStub, calls } = stubFetch({
    'GET /warehouses': {
      status: 200,
      body: {
        data: [
          {
            id: WAREHOUSE,
            name: 'Kho chính',
            phone: null,
            province: null,
            ward: null,
            addressDetail: null,
            isDefault: true,
          },
        ],
      },
    },
    [`PATCH /products/${ID}/bot-settings`]: {
      status: 200,
      body: { ...p, visibleToBot: false, botInstructions: 'Hỏi size' },
    },
  });
  vi.stubGlobal('fetch', fetchStub);
  renderWithRouter(() => <ProductForm product={p} pmsLink={pmsLink} />);
  return calls;
}

const LINK = { retailer: 'shopabc', lastSyncAt: null };

describe('ProductForm of a KiotViet-linked product', () => {
  it('shows synced fields read-only with a hint to edit them in KiotViet', async () => {
    setup(product(true), LINK);
    for (const label of ['Mã sản phẩm', 'Tên sản phẩm', 'Danh mục', 'Mô tả', 'SKU', 'Giá bán']) {
      const field = await screen.findByLabelText(new RegExp(`^${label}`));
      expect(field).toHaveAttribute('readonly');
      expect(field).not.toBeDisabled();
      expect(field).toHaveAccessibleDescription('Sửa trên KiotViet');
    }
    const links = screen.getAllByRole('link', { name: /Sửa trên KiotViet/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://shopabc.kiotviet.vn');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.queryByRole('button', { name: 'Thêm mẫu mã' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bỏ mẫu này' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bỏ ảnh 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn ảnh' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Lưu trữ (ngừng bán)' })).toBeNull();
    expect(await screen.findByText('Kho chính')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cập nhật' })).toBeNull();
  });

  it('keeps the bot settings editable and saves only them', async () => {
    const calls = setup(product(true), LINK);
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Cho bot tư vấn sản phẩm này' }),
    );
    const instructions = screen.getByRole('textbox', { name: /bot/i });
    expect(instructions).not.toHaveAttribute('readonly');
    await userEvent.type(instructions, 'Hỏi size');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
        visibleToBot: false,
        botInstructions: 'Hỏi size',
      }),
    );
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });

  it('still shows the hint without a link when the store is unknown', async () => {
    setup(product(true), null);
    const name = await screen.findByLabelText(/^Tên sản phẩm/);
    expect(name).toHaveAttribute('readonly');
    expect(name).toHaveAccessibleDescription('Sửa trên KiotViet');
    expect(screen.queryByRole('link', { name: /Sửa trên KiotViet/ })).toBeNull();
  });
});

describe('ProductForm of a Rapiz product', () => {
  it('leaves every field editable', async () => {
    setup(product(false), LINK);
    expect(await screen.findByLabelText('Tên sản phẩm')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Thêm mẫu mã' })).toBeInTheDocument();
    expect(screen.queryByText('Sửa trên KiotViet')).toBeNull();
  });
});

describe('ProductForm and the owner assistant', () => {
  it('lets the assistant fill a new product, never submitting it', async () => {
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductForm />);
    const save = await screen.findByRole('button', { name: 'Lưu sản phẩm' });
    expect(save).toHaveAttribute('data-assistant-target', 'products.save');
    expect(collectPageContext('/app/products/new').forms?.[0]).toMatchObject({
      id: 'product',
      fields: expect.arrayContaining([
        expect.objectContaining({ name: 'name', type: 'text', empty: true }),
        expect.objectContaining({ name: 'price', type: 'number', empty: true }),
        expect.objectContaining({ name: 'sku', type: 'text', empty: true, required: true }),
        expect.objectContaining({ name: 'cost', type: 'number', empty: true }),
        expect.objectContaining({ name: 'weightGram', type: 'number', empty: true }),
      ]),
    });

    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('product', {
        code: 'AT01',
        name: 'Áo thun',
        category: 'Áo',
        description: 'Cotton 100%',
        sku: 'AT01-M',
        price: 150000,
        cost: '90.000',
        weightGram: 350,
      });
    });

    expect(result).toEqual({ ok: true, submitTarget: 'products.save', opensDialog: false });
    expect(screen.getByLabelText('Tên sản phẩm')).toHaveValue('Áo thun');
    expect(screen.getByLabelText(/^Mã sản phẩm/)).toHaveValue('AT01');
    expect(screen.getByLabelText(/^Danh mục/)).toHaveValue('Áo');
    expect(screen.getByLabelText(/^Mô tả/)).toHaveValue('Cotton 100%');
    expect(screen.getByLabelText(/^SKU/)).toHaveValue('AT01-M');
    expect(screen.getByLabelText(/^Giá bán/)).toHaveValue('150.000');
    expect(screen.getByLabelText(/^Giá vốn/)).toHaveValue('90.000');
    expect(screen.getByLabelText(/^Cân nặng/)).toHaveValue('350');
    expect(collectPageContext('/app/products/new').forms?.[0]?.fields).not.toContainEqual(
      expect.objectContaining({ empty: true }),
    );
    expect(calls).toHaveLength(0);
  });

  it('does not offer an existing product to fill', async () => {
    setup(product(false), LINK);
    await screen.findByLabelText('Tên sản phẩm');
    expect(collectPageContext('/app/products/1').forms).toBeUndefined();
    expect(fillAssistantForm('product', { name: 'x' })).toEqual({
      ok: false,
      reason: 'form_not_found',
    });
  });
});

describe('ProductForm of a spa or education business', () => {
  function renderNew(kind: 'service' | 'course') {
    const { fetchStub, calls } = stubFetch({
      'POST /products': { status: 201, body: { ...product(false), offering: null } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductForm offeringKind={kind} />);
    return calls;
  }
  async function fillBasics() {
    await userEvent.type(await screen.findByLabelText(/^Mã sản phẩm/), 'DV01');
    await userEvent.type(screen.getByLabelText('Tên sản phẩm'), 'Chăm sóc da');
    await userEvent.type(screen.getByLabelText(/^SKU/), 'DV01-60');
  }

  it('sends the service details of a new spa service', async () => {
    const calls = renderNew('service');
    expect(await screen.findByRole('heading', { name: 'Chi tiết dịch vụ' })).toBeVisible();
    await fillBasics();
    await userEvent.type(screen.getByLabelText('Thời lượng mỗi buổi (phút)'), '60');
    await userEvent.type(screen.getByLabelText('Số buổi'), '10');
    await userEvent.click(screen.getByRole('radio', { name: 'Tại cơ sở' }));
    await userEvent.type(screen.getByLabelText('Kết quả đạt được'), 'Da sáng\n\nGiảm mụn\n');
    await userEvent.type(screen.getByLabelText('Ghi chú giá'), 'giá tham khảo');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /products')).toBeDefined());
    expect(calls.find((c) => c.key === 'POST /products')?.body).toMatchObject({
      code: 'DV01',
      offering: {
        kind: 'service',
        durationMinutes: 60,
        sessions: 10,
        format: 'offline',
        outcomes: ['Da sáng', 'Giảm mụn'],
        priceNote: 'giá tham khảo',
        period: '',
      },
    });
  });

  it('sends offering null once marked as retail goods', async () => {
    const calls = renderNew('course');
    expect(await screen.findByRole('heading', { name: 'Chi tiết khoá học' })).toBeVisible();
    await fillBasics();
    const retail = screen.getByRole('switch', { name: 'Đây là sản phẩm bán lẻ' });
    expect(retail).not.toBeChecked();
    await userEvent.click(retail);
    expect(screen.queryByLabelText('Số buổi')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /products')).toBeDefined());
    expect(calls.find((c) => c.key === 'POST /products')?.body).toMatchObject({ offering: null });
  });

  it('hides the stock editor of a service, and shows it once it is retail', async () => {
    const service = {
      ...product(false),
      offering: {
        kind: 'service' as const,
        durationMinutes: 60,
        sessions: null,
        period: '',
        format: null,
        level: '',
        schedule: '',
        audience: '',
        outcomes: [],
        priceNote: '',
      },
    };
    const { fetchStub, calls } = stubFetch({
      'GET /warehouses': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductForm product={service} offeringKind="service" />);
    expect(await screen.findByLabelText('Thời lượng mỗi buổi (phút)')).toHaveValue(60);
    expect(calls.some((c) => c.key === 'GET /warehouses')).toBe(false);
    await userEvent.click(screen.getByRole('switch', { name: 'Đây là sản phẩm bán lẻ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /warehouses')).toBe(true));
  });

  it('keeps a shop product free of offering details', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /products': { status: 201, body: { ...product(false), offering: null } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductForm />);
    await fillBasics();
    expect(screen.queryByRole('switch', { name: 'Đây là sản phẩm bán lẻ' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /products')).toBeDefined());
    expect(calls.find((c) => c.key === 'POST /products')?.body).not.toHaveProperty('offering');
  });
});
