import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LODGING_IDS, propertyFixture } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { PoliciesTab } from './policies-tab';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  // Radix Select uses pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const path = `/lodging/properties/${LODGING_IDS.a17}`;

/** Records each PATCH body and answers with the property it was given. */
function stubPatch(saved: ReturnType<typeof propertyFixture>) {
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '').split('?')[0]}`;
    if (key !== `PATCH ${path}`) throw new Error(`unexpected request ${key}`);
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(saved), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return bodies;
}

describe('PoliciesTab', () => {
  it('picks check-in and check-out from 24-hour half-hour slots', async () => {
    const property = propertyFixture();
    const bodies = stubPatch(property);
    const user = userEvent.setup();
    renderWithRouter(() => <PoliciesTab property={property} canEdit onDirtyChange={() => {}} />);

    const checkIn = await screen.findByRole('combobox', { name: 'Giờ nhận phòng' });
    expect(checkIn).toHaveTextContent('Chưa đặt');
    await user.click(checkIn);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(49);
    expect(options[1]).toHaveTextContent('00:00');
    expect(options[48]).toHaveTextContent('23:30');
    await user.click(screen.getByRole('option', { name: '14:00' }));
    await user.click(screen.getByRole('combobox', { name: 'Giờ trả phòng' }));
    await user.click(await screen.findByRole('option', { name: '12:00' }));
    await user.click(screen.getByRole('button', { name: 'Lưu chính sách' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      patch: { policies: { checkInTime: '14:00', checkOutTime: '12:00' } },
    });
    // Two 49-option Radix selects in jsdom take ~2 s alone and pass 5 s under full-suite load.
  }, 15_000);

  it('keeps an older free-text time until the owner picks a slot', async () => {
    const base = propertyFixture();
    const property = propertyFixture({
      policies: { ...base.policies, checkInTime: 'sau 14h' },
    });
    renderWithRouter(() => <PoliciesTab property={property} canEdit onDirtyChange={() => {}} />);
    expect(await screen.findByRole('combobox', { name: 'Giờ nhận phòng' })).toHaveTextContent(
      'sau 14h',
    );
  });
});
