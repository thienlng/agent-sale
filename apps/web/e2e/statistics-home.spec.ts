import { AnalyticsResponse } from '@agent-sales/contracts';
import { expect, test, type Page } from '@playwright/test';

import { analyticsRoute } from './support/mock-analytics';
import { mockApi } from './support/mock-api';

const A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20';
const B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'demo@example.test',
  name: 'Demo',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: false,
};

async function setup(page: Page, failedBusiness?: string, largeNumbers = false) {
  await mockApi(page);
  // With two businesses the user chooses one (T-079); these tests start from a remembered A.
  await page.addInitScript((id) => {
    if (!localStorage.getItem('rapiz.workspace')) localStorage.setItem('rapiz.workspace', id);
  }, A);
  const requests: string[] = [];
  await page.route('**/api/v1/bootstrap', (route) =>
    route.fulfill({
      json: {
        user,
        memberships: [
          { workspaceId: A, workspaceName: 'Business A', role: 'owner' },
          { workspaceId: B, workspaceName: 'Business B', role: 'sales' },
        ],
      },
    }),
  );
  await page.route('**/api/v1/analytics/query', (route) => {
    const workspace = route.request().headers()['x-workspace-id'] ?? '';
    requests.push(workspace);
    if (workspace === failedBusiness)
      return route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'denied' } },
      });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const response = AnalyticsResponse.parse(analyticsRoute('/analytics/query', body));
    response.cards = response.cards.map((card) =>
      card.state === 'ok'
        ? { ...card, value: largeNumbers ? 98_765_432 : workspace === B ? 20 : 10 }
        : card,
    );
    response.meta.scope = workspace === B ? 'own' : 'all';
    return route.fulfill({ json: response });
  });
  return requests;
}

test('opens business statistics as home while preserving existing module navigation', async ({
  page,
}) => {
  await setup(page);
  // `/` opens the account overview (T-126); a business's home is its statistics.
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/overview$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/overview$/);
  await page.goto('/app/analytics');
  await expect(page.getByRole('region', { name: 'Chỉ số chính' }).getByRole('heading')).toHaveCount(
    4,
  );
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('link').first()).toHaveText('Thống kê');
  await expect(nav.getByRole('button', { name: 'Chat đa kênh', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tin nhắn đa kênh', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nhãn được gắn', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Phân tích chi tiết', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nhãn được gắn', exact: true })).toBeVisible();
});

test('sidebar selector changes real context and clears resource-specific navigation', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto('/app/bots');
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Chọn business' })
    .getByRole('button', { name: 'Business B', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Business B',
  );
  await expect(page.getByRole('region', { name: 'Chỉ số chính' })).toContainText('20');
  expect(requests).toContain(B);
  expect(await page.evaluate(() => localStorage.getItem('rapiz.workspace'))).toBe(B);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Business B',
  );
});

test('account dropdown anchors locally and also switches business', async ({ page }) => {
  const requests = await setup(page);
  await page.goto('/app/analytics');
  const account = page.getByRole('button', { name: /Tài khoản của Demo/ });
  await account.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Đăng xuất' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Chuyển business' }).click();
  const businesses = page.getByRole('menu').last();
  await expect(businesses.getByRole('menuitem', { name: 'Business A' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await businesses.getByRole('menuitem', { name: 'Business B' }).click();
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Business B',
  );
  await expect(page.getByRole('region', { name: 'Chỉ số chính' })).toContainText('20');
  expect(requests).toContain(B);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('logo reads authorized business totals without changing the selected business', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto('/app/analytics');
  await page.getByRole('link', { name: 'Rapiz', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/overview$/);
  await expect(page.getByRole('region', { name: 'Chỉ số chính' })).toContainText('30');
  // The overview has the account sidebar, not the business selector: back in a business page,
  // the selection is still A.
  expect(await page.evaluate(() => localStorage.getItem('rapiz.workspace'))).toBe(A);
  expect(requests).toContain(A);
  expect(requests).toContain(B);
  await expect(page.getByText('Thống kê theo shop chưa có dữ liệu.')).toBeVisible();
  await expect(page.getByText(/Chỉ gồm khách bạn phụ trách/).first()).toBeVisible();
  await page.goto('/app/analytics');
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Business A',
  );
});

test('a failed business never becomes a zero or an apparently complete portfolio total', async ({
  page,
}) => {
  await setup(page, B);
  await page.goto('/app/overview');
  await expect(page.getByRole('alert')).toContainText('Chưa đủ số liệu để tính tổng.');
  await expect(page.getByRole('region', { name: 'Chỉ số chính' })).not.toContainText('10');
  await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
});

test('invalid portfolio dates prevent tenant fan-out', async ({ page }) => {
  const requests = await setup(page);
  await page.goto('/app/overview?from=2026-10-24&to=2026-10-01');
  await expect(page.getByRole('alert')).toContainText('Ngày bắt đầu phải trước ngày kết thúc.');
  expect(requests).toHaveLength(0);
});

for (const width of [375, 768, 1280, 1920])
  test(`statistics and overview fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, undefined, true);
    for (const route of ['/app/analytics', '/app/overview']) {
      await page.goto(route);
      await expect(page.getByRole('region', { name: 'Chỉ số chính' })).toBeVisible();
      await expect(page.locator('[data-metric-value]')).toHaveCount(4);
      const valueOverflow = await page.locator('[data-metric-value]').evaluateAll((values) =>
        values.some((value) => {
          const card = value.closest('[data-metric-card]');
          if (!card) return true;
          const bounds = card.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(value);
          return Array.from(range.getClientRects()).some(
            (rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1,
          );
        }),
      );
      expect(valueOverflow).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });

test('canceling an existing unsaved-profile guard keeps the previous business and draft', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/app/settings/profile');
  await page.getByLabel('Tên shop', { exact: true }).fill('Unsaved business draft');
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Chọn business' })
    .getByRole('button', { name: 'Business B', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Có thay đổi chưa lưu' })
    .getByRole('button', { name: 'Ở lại', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/settings\/profile$/);
  await expect(page.getByLabel('Tên shop', { exact: true })).toHaveValue('Unsaved business draft');
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Business A',
  );
  expect(await page.evaluate(() => localStorage.getItem('rapiz.workspace'))).toBe(A);
});

test('a late old-business response cannot appear under the newly selected business', async ({
  page,
}) => {
  await setup(page);
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route('**/api/v1/analytics/query', async (route) => {
    if (route.request().headers()['x-workspace-id'] === A && !held) {
      held = true;
      await pending;
      const response = AnalyticsResponse.parse(
        analyticsRoute(
          '/analytics/query',
          route.request().postDataJSON() as Record<string, unknown>,
        ),
      );
      response.cards = response.cards.map((card) =>
        card.state === 'ok' ? { ...card, value: 999999 } : card,
      );
      return route.fulfill({ json: response });
    }
    return route.fallback();
  });
  await page.goto('/app/analytics');
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Chọn business' })
    .getByRole('button', { name: 'Business B', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Business B',
  );
  release?.();
  await expect(page.getByRole('region', { name: 'Chỉ số chính' })).toContainText('20');
  await expect(page.getByRole('region', { name: 'Chỉ số chính' })).not.toContainText('999.999');
});
