import { expect, type Page, test } from '@playwright/test';

import { BOT_ID, mockApi, ORDER_ID, PRODUCT_ID } from './support/mock-api';
import { ADMIN_ACCOUNT_ID } from './support/mock-backoffice';
import { CONTACT_ID } from './support/mock-crm';

/**
 * Layout guard: every dashboard page, at phone to wide-desktop widths and in
 * every layout preference, renders without horizontal overflow or runtime
 * errors — with deliberately long Vietnamese content.
 */
const PAGES = [
  ['bots', '/app/bots', 'Bot của bạn'],
  ['global integrations', '/app/channels', 'Tích hợp nền tảng'],
  ['bot pages', `/app/bots/${BOT_ID}/integrations`, 'Tích hợp kênh'],
  ['bot overview', `/app/bots/${BOT_ID}`, 'Hướng dẫn Bot'],
  ['faq', `/app/bots/${BOT_ID}/knowledge`, 'Thông tin doanh nghiệp'],
  ['bot settings', `/app/bots/${BOT_ID}/settings`, 'Thiết lập Bot'],
  ['admin llm', '/admin/llm', 'Mô hình AI'],
  ['admin accounts', '/admin/accounts', 'Tài khoản'],
  ['admin account', `/admin/accounts/${ADMIN_ACCOUNT_ID}`, 'Phương Thảo 1'],
  ['admin plans', '/admin/plans', 'Gói cước'],
  ['admin payments', '/admin/payments', 'Thanh toán'],
  ['admin billing settings', '/admin/settings', 'Cài đặt thanh toán'],
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
  // A queue heading: "Hôm nay" alone also names the sidebar entry.
  ['today', '/app/today', 'Phàn nàn / cần người'],
  ['ai settings', '/app/settings/brain', 'Chăm sóc tự động'],
  ['business profile', '/app/settings/profile', 'Thông tin business'],
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

/** A collapsed icon rail shows no label text and centres every mark (logo included) on one axis. */
async function expectIconRail(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rail = document.querySelector('[data-slot="sidebar-inner"]');
        const buttons = [...(rail?.querySelectorAll('[data-sidebar="menu-button"]') ?? [])];
        const labels = buttons.flatMap((button) =>
          [...button.querySelectorAll('span')]
            .filter((s) => !s.closest('.sr-only') && s.children.length === 0)
            .filter((s) => s.textContent?.trim() && s.getBoundingClientRect().width > 1)
            .map((s) => s.textContent),
        );
        // The leading visible child is the mark: icon, business avatar or the collapsed logo.
        const centres = buttons.flatMap((button) => {
          const mark = [...button.children]
            .map((c) => c.getBoundingClientRect())
            .find((r) => r.width > 0);
          return mark ? [mark.left + mark.width / 2] : [];
        });
        const spread = Math.round(Math.max(...centres) - Math.min(...centres));
        return { labels, marks: centres.length > 0, spread };
      }),
    )
    .toEqual({ labels: [], marks: true, spread: 0 });
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

// Each combination gets its own browser context and timeout. Repeated navigation in a single
// test made an otherwise valid combination fail when earlier combinations consumed its budget.
for (const prefs of COMBOS) {
  const label = `${prefs['sidebar_variant']}/${prefs['sidebar_collapsible']}/${prefs['content_layout']}`;
  test(`layout preference combination ${label} fits, expanded and collapsed`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockApi(page);
    await page.addInitScript((p) => {
      for (const [k, v] of Object.entries(p)) localStorage.setItem(`rapiz.pref.${k}`, v);
    }, prefs);
    await page.goto(`/app/bots/${BOT_ID}/knowledge`);
    await expect(page.getByRole('heading', { name: 'Thông tin doanh nghiệp' })).toBeVisible();
    for (const [key, value] of Object.entries(prefs))
      await expect(page.locator('html')).toHaveAttribute(`data-${key.replaceAll('_', '-')}`, value);
    const sidebar = page.locator('[data-slot="sidebar"][data-state]');
    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
    await expectNoOverflow(page, JSON.stringify(prefs));
    await page.getByRole('button', { name: 'Mở hoặc thu gọn thanh bên' }).click();
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    await expectNoOverflow(page, `${JSON.stringify(prefs)} collapsed`);
    if (prefs['sidebar_collapsible'] === 'icon') await expectIconRail(page);
    await page.getByRole('button', { name: 'Mở hoặc thu gọn thanh bên' }).click();
    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
    await expectNoOverflow(page, `${JSON.stringify(prefs)} expanded again`);
    expect(errors).toEqual([]);
  });
}

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
