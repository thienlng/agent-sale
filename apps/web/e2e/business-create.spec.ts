import { expect, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

const A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20';
const NEW_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d31';
const at = '2026-10-29T08:00:00.000Z';

test('the owner creates a lodging business named Villas from the selector', async ({ page }) => {
  await mockApi(page);
  const memberships = [{ workspaceId: A, workspaceName: 'Ken Shop', role: 'owner' }];
  const user = {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
    email: 'owner@example.test',
    name: 'Demo',
    phone: null,
    emailVerified: true,
    locale: 'vi',
    timezone: 'Asia/Ho_Chi_Minh',
    isPlatformAdmin: false,
  };
  await page.route('**/api/v1/bootstrap', (route) =>
    route.fulfill({ json: { user, memberships } }),
  );
  const created: unknown[] = [];
  await page.route('**/api/v1/workspaces', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    created.push(route.request().postDataJSON());
    memberships.push({ workspaceId: NEW_ID, workspaceName: 'Villas', role: 'owner' });
    return route.fulfill({
      status: 201,
      json: {
        id: NEW_ID,
        name: 'Villas',
        industry: 'hotel',
        timezone: user.timezone,
        createdAt: at,
      },
    });
  });

  await page.goto('/app/bots');
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo business', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo business mới' });
  await expect(dialog.getByRole('button', { name: 'Tạo business', exact: true })).toBeDisabled();
  await dialog.getByLabel('Tên business').fill('Villas');
  await dialog.getByRole('radio', { name: /Khách sạn \/ homestay/ }).click();
  await dialog.getByRole('button', { name: 'Tạo business', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Villas',
  );
  expect(created).toEqual([{ name: 'Villas', industry: 'hotel' }]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('rapiz.workspace')))
    .toBe(NEW_ID);
});
