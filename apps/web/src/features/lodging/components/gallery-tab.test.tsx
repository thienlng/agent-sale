import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LODGING_IDS, propertyFixture } from '@/testing/lodging-factories';
import { renderWithProviders } from '@/testing/render';

import { GalleryTab } from './gallery-tab';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const path = `/lodging/properties/${LODGING_IDS.a17}`;

describe('GalleryTab', () => {
  it('saves every folder and the chosen cover as one PATCH', async () => {
    const photo = { kind: 'image' as const, url: 'https://cdn.example.com/1.jpg', caption: '' };
    const property = propertyFixture({
      gallery: [{ id: 'rooms', name: 'Phòng ngủ', items: [photo] }],
      galleryCover: '',
    });
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '').split('?')[0]}`;
      if (key !== `PATCH ${path}`) throw new Error(`unexpected request ${key}`);
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(property), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    function Harness() {
      const [folder, setFolder] = useState<string | undefined>();
      return (
        <GalleryTab
          property={property}
          canEdit
          onDirtyChange={() => {}}
          folderId={folder}
          onFolderChange={setFolder}
        />
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), 'Ngoài trời');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    await user.click(screen.getByRole('button', { name: 'Mở thư mục Phòng ngủ' }));
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt làm ảnh bìa' }));
    await user.click(screen.getByRole('button', { name: 'Lưu ảnh & video' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      version: property.version,
      patch: {
        gallery: [
          { id: 'rooms', name: 'Phòng ngủ', items: [photo] },
          { id: expect.any(String), name: 'Ngoài trời', items: [] },
        ],
        galleryCover: photo.url,
      },
    });
  });
});
