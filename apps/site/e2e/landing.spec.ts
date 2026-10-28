import { expect, type Page, test } from '@playwright/test';

/** Ported from the standalone landing repo's verify scripts, plus the links into the dashboard. */

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function loadAllImages(page: Page) {
  await page.locator('img[loading=lazy]').evaluateAll((imgs) =>
    Promise.all(
      (imgs as HTMLImageElement[]).map((img) => {
        img.loading = 'eager';
        return img.decode();
      }),
    ),
  );
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('header and calls to action lead to the dashboard sign-up and log-in', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('header');
  await expect(header.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', /\/login$/);
  await expect(header.getByRole('link', { name: 'Dùng thử miễn phí' })).toHaveAttribute(
    'href',
    /\/signup$/,
  );
  // Hero, closing section and the demo dialog each offer the free trial.
  await expect(page.locator('main a[href$="/signup"]')).toHaveCount(2);
  await page.locator('.footer-top [data-contact]').click();
  await expect(page.locator('dialog a[href$="/signup"]')).toBeVisible();
  await expect(page.getByText('chưa kết nối AI hay tài khoản bán hàng')).toHaveCount(0);
});

test('phone header keeps one call to action and moves log-in into the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('header .nav-login')).toBeHidden();
  await expect(page.locator('header .nav-cta')).toBeVisible();
  await page.locator('.menu-toggle').click();
  await expect(page.locator('#navigation').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  const cta = await page.locator('header .nav-cta').boundingBox();
  expect(cta!.height).toBeGreaterThanOrEqual(44);
});

test('content, demo tabs, dialog, FAQ and layout at every width', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.goto('/', { waitUntil: 'networkidle' });
  expect(response!.status()).toBe(200);
  await loadAllImages(page);
  await expect(page.locator('.friend-animation')).toHaveCount(6);
  const assets = await page
    .locator('img[src^="/images/friends/"]')
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));
  expect(new Set(assets).size).toBe(13);
  expect(await page.locator('.rabbit').getAttribute('src')).toMatch(/\.gif$/);

  for (const industry of ['beauty', 'education', 'service', 'fashion']) {
    await page.locator(`[data-industry="${industry}"]`).click();
    await expect(page.locator(`[data-industry="${industry}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect((await page.locator('#bot-message').textContent())!.length).toBeGreaterThan(50);
  }
  await page.locator('[data-industry="fashion"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-industry="beauty"]')).toHaveAttribute('aria-selected', 'true');

  const dialogOpen = () => page.locator('dialog').evaluate((el) => (el as HTMLDialogElement).open);
  await page.locator('.footer-top [data-contact]').click();
  expect(await dialogOpen()).toBe(true);
  await page.keyboard.press('Escape');
  expect(await dialogOpen()).toBe(false);
  await page.locator('.footer-top [data-contact]').click();
  await page.locator('#explore-demo').click();
  expect(await dialogOpen()).toBe(false);

  await page.locator('details summary').first().click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await noOverflow(page), `overflow at ${width}`).toBe(true);
    await page.evaluate(() => scrollTo({ top: 1500, behavior: 'instant' }));
    expect(
      Math.abs((await page.locator('.header').boundingBox())!.y),
      `sticky at ${width}`,
    ).toBeLessThan(1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.menu-toggle').click();
  await expect(page.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#navigation a').first().click();
  await expect(page.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});

test('reduced motion swaps every animation for its still frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(await page.locator('.rabbit').getAttribute('src')).toMatch(/still\.png$/);
  await loadAllImages(page);
  for (const friend of await page.locator('.friend-animation').all()) {
    expect(await friend.evaluate((img) => (img as HTMLImageElement).currentSrc)).toMatch(
      /-still\.png$/,
    );
  }
});

test('theme follows the system, persists a manual choice and syncs across tabs', async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const theme = () => page.locator('html').getAttribute('data-theme');
  expect(await theme()).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');

  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('dark');
  await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-label', 'Bật giao diện sáng');
  await page.reload({ waitUntil: 'networkidle' });
  expect(await theme()).toBe('dark');
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await noOverflow(page), `dark overflow at ${width}`).toBe(true);
  }

  const other = await context.newPage();
  await other.goto('/', { waitUntil: 'networkidle' });
  await other.locator('.theme-toggle').click();
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');
  expect(errors).toEqual([]);
  await context.close();
});

test('theme still switches when storage is blocked', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  await context.addInitScript(() => {
    const deny = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    Object.defineProperty(Storage.prototype, 'getItem', { value: deny });
    Object.defineProperty(Storage.prototype, 'setItem', { value: deny });
  });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
  await context.close();
});
