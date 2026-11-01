import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LODGING_IDS, stubLodgingApi, summaryFixture } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { BotProperties } from './bot-properties';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const a17 = summaryFixture();
const h1 = summaryFixture({
  id: LODGING_IDS.h1,
  code: 'H1',
  name: 'Homestay Hoa Sứ',
  sellMode: 'rooms',
});
const botPath = `/lodging/bots/${LODGING_IDS.bot}/properties`;

function stub(selected: string[]) {
  const { fetchStub, calls } = stubLodgingApi({
    'GET /lodging/properties': { status: 200, body: { data: [a17, h1] } },
    [`GET ${botPath}`]: { status: 200, body: { propertyIds: selected } },
    [`PUT ${botPath}`]: { status: 200, body: { propertyIds: [a17.id] } },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

describe('BotProperties', () => {
  it('lists places with a switch each and never says "sản phẩm"', async () => {
    const calls = stub([a17.id, h1.id]);
    renderWithRouter(() => <BotProperties botId={LODGING_IDS.bot} />);
    const h1Switch = await screen.findByRole('switch', { name: 'Bot bán H1 · Homestay Hoa Sứ' });
    await waitFor(() => expect(h1Switch).toBeChecked());
    expect(screen.getByRole('switch', { name: 'Tất cả căn' })).toBeChecked();
    expect(document.body).not.toHaveTextContent(/sản phẩm/i);

    await userEvent.click(h1Switch);
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PUT ${botPath}`)?.body).toEqual({
        propertyIds: [a17.id],
      }),
    );
  });

  it('turns "all places" back on with an empty list', async () => {
    const calls = stub([a17.id]);
    renderWithRouter(() => <BotProperties botId={LODGING_IDS.bot} />);
    const all = await screen.findByRole('switch', { name: 'Tất cả căn' });
    await waitFor(() => expect(all).not.toBeChecked());
    await userEvent.click(all);
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PUT ${botPath}`)?.body).toEqual({ propertyIds: [] }),
    );
  });
});
