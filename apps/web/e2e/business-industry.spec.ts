import { expect, test, type Page } from '@playwright/test';
import { BOT_ID, mockApi } from './support/mock-api';

const A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20';
const B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const at = '2026-10-28T08:00:00.000Z';

async function setup(page: Page, industry = 'hotel') {
  await mockApi(page);
  // With two businesses the user chooses one (T-079); these tests start from a remembered A.
  await page.addInitScript((id) => {
    if (!localStorage.getItem('rapiz.workspace')) localStorage.setItem('rapiz.workspace', id);
  }, A);
  await page.route('**/api/v1/bootstrap', (route) =>
    route.fulfill({
      json: {
        user: {
          id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
          email: 'owner@example.test',
          name: 'Demo',
          phone: null,
          emailVerified: true,
          locale: 'vi',
          timezone: 'Asia/Ho_Chi_Minh',
          isPlatformAdmin: false,
        },
        memberships: [
          { workspaceId: A, workspaceName: 'Hotel business', role: 'owner' },
          { workspaceId: B, workspaceName: 'Spa business', role: 'owner' },
        ],
      },
    }),
  );
  await page.route('**/api/v1/workspaces/current', (route) => {
    const id = route.request().headers()['x-workspace-id'];
    return route.fulfill({
      json: {
        id,
        name: id === B ? 'Spa business' : 'Hotel business',
        industry: id === B ? 'spa' : industry,
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: at,
      },
    });
  });
}

test('business settings and new bots follow the sidebar business without an extra industry choice', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/app/settings/profile');
  const section = page.getByRole('region', { name: 'Lĩnh vực doanh nghiệp' });
  await expect(section.getByText('Hotel business', { exact: true })).toBeVisible();
  await expect(section.getByLabel('Lĩnh vực kinh doanh')).toHaveValue('Khách sạn / homestay');
  await expect(section.getByLabel('Lĩnh vực kinh doanh')).toHaveAttribute('readonly');
  await page.goto('/app/bots');
  await page.getByRole('button', { name: 'Tạo bot', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Lĩnh vực kinh doanh')).toHaveValue('Khách sạn / homestay');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Chọn business' })
    .getByRole('button', { name: 'Spa business', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Spa business',
  );
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rapiz.workspace'))).toBe(B);
  await page.goto('/app/bots');
  await page.getByRole('button', { name: 'Tạo bot', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Lĩnh vực kinh doanh')).toHaveValue('Spa / làm đẹp');
  await dialog.getByLabel('Tên bot').fill('Spa assistant');
  const requests: Array<{ body: unknown; workspace: string | undefined }> = [];
  await page.route('**/api/v1/bots', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as { name: string; industry: string };
    requests.push({ body, workspace: route.request().headers()['x-workspace-id'] });
    return route.fulfill({
      status: 201,
      json: {
        id: BOT_ID,
        ...body,
        isActive: false,
        createdAt: at,
        updatedAt: at,
        settings: {
          mission: '',
          greeting: '',
          selfPronoun: 'em',
          customerPronoun: 'anh/chị',
          useCustomerName: true,
          fallbackMessage: '',
          handoffMessage: '',
          creativity: 'balanced',
          modelTier: 'smart',
          language: 'vi',
          placeholders: {},
        },
      },
    });
  });
  await dialog.getByRole('button', { name: 'Tạo bot', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/bots/${BOT_ID}/integrations$`));
  expect(requests).toEqual([{ body: { name: 'Spa assistant', industry: 'spa' }, workspace: B }]);
});

test('industry context fits a narrow create dialog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/app/bots');
  const notice = page.getByText(/Bot đang dùng lĩnh vực cũ/).first();
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())?.width).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Tạo bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Lĩnh vực kinh doanh')).toHaveValue('Khách sạn / homestay');
  await expect(dialog.getByText(/Bot mới dùng đúng lĩnh vực doanh nghiệp/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('business-industry-mobile.png'),
    fullPage: true,
  });
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('an unsupported stored industry blocks creation without silently using retail', async ({
  page,
}) => {
  await setup(page, 'legacy-rooms');
  await page.goto('/app/bots');
  await page.getByRole('button', { name: 'Tạo bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('legacy-rooms');
  await expect(dialog.getByLabel('Lĩnh vực kinh doanh')).toHaveValue('legacy-rooms');
  await expect(dialog.getByRole('button', { name: 'Tạo bot', exact: true })).toBeDisabled();
});
