import {
  type APIRequestContext,
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from '@playwright/test';

/**
 * Orders against the real backend (#23): what the mocked smoke tests cannot prove —
 * persistence, stock reservations, snapshot prices, cancellation and the source
 * field policies. One new shop per run (signup), so runs are isolated and repeatable.
 */

const password = 'live e2e password 2026';
const email = `live-${Date.now()}-${Math.round(Math.random() * 1e6)}@e2e.rapiz.test`;
const PRODUCT = `Áo thun E2E ${Date.now()}`;

let api: APIRequestContext;
let page: Page;
let productId = '';
let variantId = '';

type Stock = { onHand: number; reserved: number; available: number };
type Order = {
  id: string;
  code: string;
  status: string;
  items: Array<{ qty: number; unitPrice: number }>;
  amounts: { subtotal: number; gross: number; total: number; paid: number; cod: number };
};

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

const stock = async (): Promise<Stock> => {
  const p = await json<{ variants: Array<{ id: string; stock: Stock[] }> }>(
    await api.get(`/api/v1/products/${productId}`),
  );
  const s = p.variants.find((v) => v.id === variantId)?.stock[0];
  if (!s) throw new Error('no stock row');
  return s;
};
const order = (id: string) => api.get(`/api/v1/orders/${id}`).then((r) => json<Order>(r));
const orderCount = async () =>
  (await json<{ total: number }>(await api.get('/api/v1/orders'))).total;
const orderIdFromUrl = () => new URL(page.url()).pathname.split('/').pop() ?? '';

async function openNewOrder() {
  await page.goto('/app/orders/new');
  await expect(page.getByRole('heading', { name: 'Tạo đơn hàng mới' })).toBeVisible();
}

async function pickSource(name: string) {
  await page.getByLabel('Nguồn đơn').click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function addProduct(qty: number) {
  await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill(PRODUCT);
  await page.getByRole('option', { name: new RegExp(PRODUCT) }).click();
  await page.getByLabel('SL', { exact: true }).fill(String(qty));
}

async function changeStatus(name: string) {
  await page.getByLabel('Đổi trạng thái').first().click();
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Cập nhật', exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ baseURL, browser }) => {
  // A new shop with one warehouse and one product holding 10 in stock.
  const anon = await playwrightRequest.newContext({ baseURL: baseURL ?? '' });
  const auth = await json<{ accessToken: string }>(
    await anon.post('/api/v1/auth/signup', {
      data: {
        name: 'Chủ shop E2E',
        email,
        password,
        workspaceName: 'Shop E2E',
        industry: 'fashion',
      },
    }),
  );
  const boot = await json<{ memberships: Array<{ workspaceId: string }> }>(
    await anon.get('/api/v1/bootstrap', {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    }),
  );
  await anon.dispose();
  api = await playwrightRequest.newContext({
    baseURL: baseURL ?? '',
    extraHTTPHeaders: {
      authorization: `Bearer ${auth.accessToken}`,
      'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
    },
  });
  const warehouse = await json<{ id: string }>(
    await api.post('/api/v1/warehouses', { data: { name: 'Kho E2E' } }),
  );
  const product = await json<{ id: string; variants: Array<{ id: string }> }>(
    await api.post('/api/v1/products', {
      data: {
        code: `E2E-${Date.now()}`,
        name: PRODUCT,
        variants: [{ sku: `E2E-SKU-${Date.now()}`, name: '', price: 125_000, cost: 70_000 }],
      },
    }),
  );
  productId = product.id;
  variantId = product.variants[0]?.id ?? '';
  await json(
    await api.post(`/api/v1/products/${productId}/stock`, {
      data: { variantId, warehouseId: warehouse.id, onHand: 10 },
    }),
  );

  page = await browser.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
});

test.afterAll(async () => {
  await page?.close();
  await api?.dispose();
});

test('an order reserves stock, keeps its prices, takes payments and gives stock back when cancelled', async () => {
  await openNewOrder();
  await addProduct(2);
  await page.getByLabel('Họ và tên').fill('Khách E2E');
  await page.getByLabel('Số điện thoại').fill('0901234567');
  await page.getByRole('textbox', { name: 'Địa chỉ', exact: true }).fill('12 Lê Lợi, Quận 1');
  await page.getByRole('button', { name: 'Tạo đơn (F2)' }).click();
  await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/);
  const id = orderIdFromUrl();
  expect(await stock()).toMatchObject({ onHand: 10, reserved: 2, available: 8 });

  await changeStatus('Đã xác nhận');
  await expect.poll(async () => (await order(id)).status).toBe('confirmed');

  // A payment received after creation.
  const shippingPanel = page.locator('section', {
    has: page.getByRole('heading', { name: 'Vận chuyển · Ghi chú' }),
  });
  await shippingPanel.getByRole('button', { name: 'Sửa', exact: true }).click();
  await page.getByLabel('Đã chuyển khoản').fill('100000');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect.poll(async () => (await order(id)).amounts.paid).toBe(100_000);
  expect((await order(id)).amounts).toMatchObject({ total: 250_000, cod: 150_000 });

  // The catalog price changes; the order keeps the price it was sold at.
  const product = await json<{ code: string; variants: Array<Record<string, unknown>> }>(
    await api.get(`/api/v1/products/${productId}`),
  );
  await json(
    await api.put(`/api/v1/products/${productId}`, {
      data: {
        code: product.code,
        name: PRODUCT,
        variants: product.variants.map((v) => ({
          id: v['id'],
          sku: v['sku'],
          name: v['name'],
          price: 150_000,
          cost: v['cost'],
        })),
      },
    }),
  );

  // Two becomes three: the reservation follows, the snapshot price stays.
  await page.reload();
  await page.getByRole('button', { name: 'Sửa sản phẩm' }).click();
  await page.getByLabel('SL', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect.poll(async () => (await order(id)).items[0]?.qty).toBe(3);
  expect((await order(id)).items[0]?.unitPrice).toBe(125_000);
  expect(await stock()).toMatchObject({ onHand: 10, reserved: 3, available: 7 });

  await changeStatus('Đã huỷ');
  await expect.poll(async () => (await order(id)).status).toBe('cancelled');
  expect(await stock()).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
});

test('overselling warns, and a double F2 creates one order', async () => {
  const before = await orderCount();
  await openNewOrder();
  await addProduct(11);
  await expect(page.getByText(/Vượt tồn kho \(còn 10\)/)).toBeVisible();
  await page.getByLabel('Họ và tên').fill('Khách đặt trước');
  await page.getByLabel('Số điện thoại').fill('0912345678');
  await page.getByRole('textbox', { name: 'Địa chỉ', exact: true }).fill('5 Hai Bà Trưng');
  await page.keyboard.press('F2');
  await page.keyboard.press('F2');
  await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/);
  expect(await orderCount()).toBe(before + 1);
  expect(await stock()).toMatchObject({ reserved: 11, available: -1 });
  await changeStatus('Đã huỷ');
  await expect.poll(async () => (await stock()).reserved).toBe(0);
});

test('each source asks for its own fields: hotline drafts may skip the phone until confirmed', async () => {
  // Facebook (default policy) needs delivery details to save.
  await openNewOrder();
  await addProduct(1);
  await page.getByLabel('Họ và tên').fill('Khách Facebook');
  await page.getByRole('button', { name: 'Tạo đơn (F2)' }).click();
  await expect(page).toHaveURL(/\/app\/orders\/new$/);
  await expect(page.getByLabel('Số điện thoại')).toHaveAttribute('required', '');

  // Hotline saves a draft without them…
  await pickSource('Hotline');
  await expect(page.getByLabel('Số điện thoại')).not.toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Tạo đơn (F2)' }).click();
  await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/);
  const id = orderIdFromUrl();

  // …but cannot confirm it until they are filled in.
  await changeStatus('Đã xác nhận');
  await expect(page.getByText(/Cần nhập: SĐT người nhận, Địa chỉ nhận hàng/)).toBeVisible();
  expect((await order(id)).status).toBe('new');

  const people = page.locator('section', {
    has: page.getByRole('heading', { name: 'Khách hàng & nhận hàng' }),
  });
  await people.getByRole('button', { name: 'Sửa', exact: true }).click();
  await page.locator('#od-r-phone').fill('0987654321');
  await page.locator('#od-r-address').fill('8 Nguyễn Huệ');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã cập nhật khách hàng & nhận hàng')).toBeVisible();
  await changeStatus('Đã xác nhận');
  await expect.poll(async () => (await order(id)).status).toBe('confirmed');
});
