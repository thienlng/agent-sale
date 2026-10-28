import { expect, type Page, test } from '@playwright/test';

import { BOT_ID, mockApi, ORDER_ID, PRODUCT_ID } from './support/mock-api';
import { CONTACT_ID } from './support/mock-crm';

/**
 * Layout guard: every dashboard page, at phone to wide-desktop widths and in
 * every layout preference, renders without horizontal overflow or runtime
 * errors — with deliberately long Vietnamese content.
 */
const PAGES = [
  ['bots', '/app/bots', 'Bot của bạn'],
  ['global integrations', '/app/channels', 'Tích hợp nền tảng'],
  ['bot pages', `/app/bots/${BOT_ID}/integrations`, 'Quản lý fanpage và kênh'],
  ['bot overview', `/app/bots/${BOT_ID}`, 'Hướng dẫn Bot'],
  ['faq', `/app/bots/${BOT_ID}/knowledge`, 'Thông tin doanh nghiệp'],
  ['bot settings', `/app/bots/${BOT_ID}/settings`, 'Thiết lập Bot'],
  ['admin llm', '/admin/llm', 'Mô hình AI'],
  ['orders', '/app/orders', 'Danh sách đơn hàng'],
  ['order detail', `/app/orders/${ORDER_ID}`, 'DH000123'],
  ['new order', '/app/orders/new', 'Tạo đơn hàng mới'],
  ['overview', '/app/orders/overview', 'Tổng quan đơn hàng'],
  ['products', '/app/products', 'Sản phẩm'],
  ['product', `/app/products/${PRODUCT_ID}`, 'Sửa sản phẩm'],
  ['status settings', '/app/order-settings/statuses', 'Thiết lập đơn hàng'],
  ['source policies', '/app/order-settings/sources', 'Thiết lập đơn hàng'],
  ['warehouses', '/app/order-settings/warehouses', 'Thiết lập đơn hàng'],
  ['contacts', '/app/contacts', 'Khách hàng'],
  [
    'contact drawer',
    `/app/contacts?contact=${CONTACT_ID}`,
    'Nguyễn Thị Thanh Hương Lan Anh Phương Thảo Ngọc Bích',
  ],
  ['crm statuses', '/app/crm-settings/statuses', 'Cài đặt khách hàng'],
  ['crm sources', '/app/crm-settings/sources', 'Cài đặt khách hàng'],
  ['crm tags', '/app/crm-settings/tags', 'Cài đặt khách hàng'],
  ['crm distribution', '/app/crm-settings/distribution', 'Cài đặt khách hàng'],
  ['members', '/app/members', 'Thành viên & quyền truy cập'],
  ['statistics', '/app/analytics', 'Khách hàng mới'],
  ['shop profile', '/app/settings/profile', 'Thông tin shop'],
  ['security', '/app/settings/security', 'Xác minh 2 bước'],
  ['audit trail', '/app/settings/audit', 'Nhật ký thay đổi'],
  ['join', `/join?token=${'t'.repeat(43)}`, 'Lời mời tham gia shop'],
] as const;

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: horizontal overflow (px)`).toBeLessThanOrEqual(0);
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

for (const viewport of VIEWPORTS) {
  for (const [name, url, heading] of PAGES) {
    test(`${name} fits at ${viewport.width}px`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.setViewportSize(viewport);
      await mockApi(page);
      await page.goto(url);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await expectNoOverflow(page, `${name} @${viewport.width}`);
      expect(errors).toEqual([]);
    });
  }
}

const COMBOS: Array<Record<string, string>> = [];
for (const sidebar_variant of ['sidebar', 'inset', 'floating'])
  for (const sidebar_collapsible of ['icon', 'offcanvas'])
    for (const content_layout of ['centered', 'full-width'])
      COMBOS.push({
        sidebar_variant,
        sidebar_collapsible,
        content_layout,
        navbar_style: content_layout === 'centered' ? 'sticky' : 'scroll',
        theme_mode: sidebar_variant === 'inset' ? 'dark' : 'light',
      });

test('every layout preference combination fits, expanded and collapsed', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page);
  for (const prefs of COMBOS) {
    await page.addInitScript((p) => {
      for (const [k, v] of Object.entries(p)) localStorage.setItem(`rapiz.pref.${k}`, v);
    }, prefs);
    await page.goto(`/app/bots/${BOT_ID}/knowledge`);
    await expect(page.locator('html')).toHaveAttribute(
      'data-sidebar-variant',
      prefs['sidebar_variant']!,
    );
    await expectNoOverflow(page, JSON.stringify(prefs));
    await page.getByRole('button', { name: 'Mở hoặc thu gọn thanh bên' }).click();
    await expectNoOverflow(page, `${JSON.stringify(prefs)} collapsed`);
    await page.getByRole('button', { name: 'Mở hoặc thu gọn thanh bên' }).click();
  }
  expect(errors).toEqual([]);
});

test('preferences apply instantly and survive a reload', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app/bots');
  await page.getByRole('button', { name: /Tài khoản của/ }).click();
  await page.getByRole('menuitem', { name: /Màn hình và ngôn ngữ/ }).click();
  await page.getByRole('menuitem', { name: 'Tùy chỉnh bố cục' }).click();
  await page.getByRole('radio', { name: 'Biển' }).click();
  await page.getByRole('radio', { name: 'Toàn màn hình' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'ocean');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preset', 'ocean');
  await expect(page.locator('html')).toHaveAttribute('data-content-layout', 'full-width');
});
