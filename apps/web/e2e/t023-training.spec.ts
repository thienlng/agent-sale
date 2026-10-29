import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import type { TrainingHistoryDto, TrainingItemDto } from '@agent-sales/contracts';

import { BOT_ID, mockApi } from './support/mock-api';

/** Stateful fake transport verifies the actual forms and query invalidation without provider calls. */
async function trainingApi(page: Page) {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem('rapiz.locale', 'en'));
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
        actor: 'Synthetic Owner',
        changes: [],
        // Like the API: restoring a creation deletes the item.
        restorable: true,
        // Now, so the entry falls inside the history page's default date range.
        createdAt: new Date().toISOString(),
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
      const fields = ['title', 'content', 'trigger', 'notes', 'mediaUrl', 'folderId'] as const;
      const changes = fields
        .filter((field) => (current[field] ?? null) !== (changed[field] ?? null))
        .map((field) => ({ field, before: current[field] ?? null, after: changed[field] ?? null }));
      history.unshift({
        id: randomUUID(),
        botId: BOT_ID,
        itemId: current.id,
        title: changed.title,
        kind: current.kind,
        action: 'updated',
        actor: 'Synthetic Owner',
        changes,
        restorable: true,
        // Now, so the entry falls inside the history page's default date range.
        createdAt: new Date().toISOString(),
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
        actor: 'Synthetic Owner',
        changes: [],
        restorable: true,
        // Now, so the entry falls inside the history page's default date range.
        createdAt: new Date().toISOString(),
      });
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  return { items, history };
}

async function addInstruction(page: Page, title: string, content: string) {
  await page.getByRole('button', { name: 'Add rule', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add item' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Content / handling instructions').fill(content);
  return dialog;
}

/** Empty state of the rules page (T-070 replaced the instruction list with grouped rules). */
const NO_RULES = 'No rules yet. Add a rule or use the starter set.';

test('instructions support create, edit, reload, delete and an accurate history', async ({
  page,
}) => {
  const state = await trainingApi(page);
  await page.goto(`/app/bots/${BOT_ID}/instructions`);
  await expect(page.getByRole('heading', { name: 'Bot rules' })).toBeVisible();
  await expect(page.getByText(NO_RULES)).toBeVisible();
  const dialog = await addInstruction(
    page,
    'Synthetic return instructions',
    'Ask for the synthetic order code.',
  );
  await dialog.getByLabel('Situation or shortcut').fill('return request');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Synthetic return instructions' })).toBeVisible();
  expect(state.items).toMatchObject([{ kind: 'scenario', trigger: 'return request' }]);
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Edit item' })
    .getByLabel('Title', { exact: true })
    .fill('Synthetic updated instructions');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic updated instructions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic return instructions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(NO_RULES)).toBeVisible();
  expect(state.items).toHaveLength(0);
  await page.goto(`/app/bots/${BOT_ID}/history`);
  await page.getByRole('tab', { name: 'Training data' }).click();
  const entries = page.getByRole('listitem').filter({ hasText: 'Synthetic Owner' });
  await expect(entries).toHaveText([
    /Synthetic Owner deleted rule Synthetic updated instructions/,
    /Synthetic Owner edited rule Synthetic updated instructions/,
    /Synthetic Owner added rule Synthetic return instructions/,
  ]);
  // The edit lists exactly the changed field, before → after, and can be restored.
  await expect(entries.nth(1).getByRole('listitem')).toHaveText([
    'Changed Title Synthetic return instructions → Synthetic updated instructions',
  ]);
  await expect(entries.nth(1).getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(entries.nth(2).getByRole('button', { name: 'Restore' })).toBeVisible();
});

test('quick replies are separate from instructions and the image library redirects home', async ({
  page,
}) => {
  const state = await trainingApi(page);
  await page.goto(`/app/bots/${BOT_ID}/quick-replies`);
  await page.getByRole('button', { name: 'Add new', exact: true }).click();
  const reply = page.getByRole('dialog', { name: 'Add quick reply' });
  await reply.getByLabel('Shortcut', { exact: true }).fill('/thanks');
  await reply
    .getByLabel('Content', { exact: true })
    .fill('Thanks for contacting the synthetic shop.');
  await reply.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '/thanks', exact: true })).toBeVisible();
  await expect(page.getByText('Thanks for contacting the synthetic shop.')).toBeVisible();
  expect(state.items).toMatchObject([{ kind: 'quick_reply', trigger: 'thanks' }]);
  await page.goto(`/app/bots/${BOT_ID}/instructions`);
  await expect(page.getByText(NO_RULES)).toBeVisible();
  await expect(page.getByText('/thanks')).toHaveCount(0);

  // The image library left the bot menu (T-114): old links land on the bot home.
  await page.goto(`/app/bots/${BOT_ID}/media`);
  await expect(page).toHaveURL(new RegExp(`/app/bots/${BOT_ID}$`));
  await expect(page.getByRole('link', { name: 'Image library' })).toHaveCount(0);
});

test('new training screens fit a phone and recover from a load error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await trainingApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, heading] of [
    ['instructions', 'Bot rules'],
    ['quick-replies', 'Quick replies'],
    ['history', 'Edit history'],
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
  await expect(page.getByRole('alert').getByText('Could not load the data.')).toBeVisible();
  await page.unroute('**/training-items');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(NO_RULES)).toBeVisible();
  await expect(page.getByRole('alert').getByText('Could not load the data.')).toHaveCount(0);
  expect(errors).toEqual([]);
});
