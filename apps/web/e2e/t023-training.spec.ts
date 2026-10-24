import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import type { TrainingHistoryDto, TrainingItemDto } from '@agent-sales/contracts';

import { BOT_ID, mockApi } from './support/mock-api';

/** Stateful fake transport verifies the actual forms and query invalidation without provider calls. */
async function trainingApi(page: Page) {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem('razpi.locale', 'en'));
  const items: TrainingItemDto[] = [];
  const history: TrainingHistoryDto[] = [];
  await page.route('**/api/v1/bots/*/training-**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith('/training-history')) return json({ data: history });
    const id = path.split('/training-items/')[1];
    if (request.method() === 'GET') return json({ data: items });
    if (request.method() === 'POST') {
      const now = '2026-10-24T05:00:00.000Z';
      const item = {
        ...request.postDataJSON(),
        id: randomUUID(),
        botId: BOT_ID,
        createdAt: now,
        updatedAt: now,
      } as TrainingItemDto;
      items.push(item);
      history.unshift({
        id: randomUUID(),
        botId: BOT_ID,
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        action: 'created',
        createdAt: now,
      });
      return json(item, 201);
    }
    const index = items.findIndex((item) => item.id === id);
    if (index < 0)
      return json({ error: { code: 'NOT_FOUND', message: 'Synthetic item not found' } }, 404);
    const current = items[index]!;
    if (request.method() === 'PATCH') {
      const changed = { ...current, ...request.postDataJSON() } as TrainingItemDto;
      items[index] = changed;
      history.unshift({
        id: randomUUID(),
        botId: BOT_ID,
        itemId: current.id,
        title: changed.title,
        kind: current.kind,
        action: 'updated',
        createdAt: current.createdAt,
      });
      return json(changed);
    }
    if (request.method() === 'DELETE') {
      items.splice(index, 1);
      history.unshift({
        id: randomUUID(),
        botId: BOT_ID,
        itemId: current.id,
        title: current.title,
        kind: current.kind,
        action: 'deleted',
        createdAt: current.createdAt,
      });
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  return { items, history };
}

async function addItem(page: Page, title: string, content: string) {
  await page.getByRole('button', { name: 'Add item', exact: true }).first().click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Content / handling instructions').fill(content);
}

test('instructions support create, edit, reload, delete and an accurate history', async ({
  page,
}) => {
  await trainingApi(page);
  await page.goto(`/app/bots/${BOT_ID}/instructions`);
  await expect(
    page.getByRole('heading', { name: 'Situation-handling instructions' }),
  ).toBeVisible();
  await addItem(page, 'Synthetic return instructions', 'Ask for the synthetic order code.');
  await page.getByLabel('Situation or shortcut').fill('return request');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Synthetic return instructions' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Synthetic updated instructions');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic updated instructions' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
  await page.goto(`/app/bots/${BOT_ID}/history`);
  await expect(page.getByText('Instruction · Created', { exact: true })).toBeVisible();
  await expect(page.getByText('Instruction · Updated', { exact: true })).toBeVisible();
  await expect(page.getByText('Instruction · Deleted', { exact: true })).toBeVisible();
});

test('quick replies are separate from instructions and media rejects insecure links', async ({
  page,
}) => {
  const state = await trainingApi(page);
  await page.goto(`/app/bots/${BOT_ID}/quick-replies`);
  await addItem(page, 'Synthetic team reply', 'Thanks for contacting the synthetic shop.');
  await page.getByLabel('Situation or shortcut').fill('/thanks');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic team reply' })).toBeVisible();
  await page.goto(`/app/bots/${BOT_ID}/instructions`);
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
  await page.goto(`/app/bots/${BOT_ID}/media`);
  await addItem(page, 'Synthetic media', 'Synthetic product reference.');
  await page.getByLabel('HTTPS media URL').fill('http://example.test/synthetic.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('Please fill in a title and content, and use a valid HTTPS media link.'),
  ).toBeVisible();
  expect(state.items).toHaveLength(1);
  await page.getByLabel('HTTPS media URL').fill('https://example.test/synthetic.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic media' })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'https://example.test/synthetic.png' }),
  ).toHaveAttribute('href', 'https://example.test/synthetic.png');
});

test('new training screens fit a phone and recover from a load error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await trainingApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, heading] of [
    ['instructions', 'Situation-handling instructions'],
    ['quick-replies', 'Quick replies'],
    ['media', 'Image library'],
    ['history', 'Training edit history'],
  ] as const) {
    await page.goto(`/app/bots/${BOT_ID}/${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      path,
    ).toBeLessThanOrEqual(0);
  }
  await page.route('**/training-items', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'Synthetic outage' } },
    }),
  );
  await page.goto(`/app/bots/${BOT_ID}/instructions`);
  await expect(
    page.getByRole('alert').getByText('Unable to load training materials.'),
  ).toBeVisible();
  await page.unroute('**/training-items');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'No items yet' })).toBeVisible();
  expect(errors).toEqual([]);
});
