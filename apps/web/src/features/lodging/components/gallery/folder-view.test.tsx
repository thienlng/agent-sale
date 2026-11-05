import type { GalleryFolder } from '@agent-sales/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import type { GalleryDraft } from '../../lib/gallery-model';
import { FolderView } from './folder-view';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

const img = (n: number) => ({
  kind: 'image' as const,
  url: `https://cdn.example.com/${n}.jpg`,
  caption: '',
});
const VIDEO = {
  kind: 'video' as const,
  url: '/media/lodging/0192f0a0-0000-7000-8000-000000000001/0192f0a0-0000-7000-8000-0000000000cc.mp4',
  caption: 'Tour',
};
/** Photo 1, a video, then photos 2..10. */
const rooms: GalleryFolder = {
  id: 'rooms',
  name: 'Phòng ngủ',
  items: [img(1), VIDEO, ...Array.from({ length: 9 }, (_, i) => img(i + 2))],
};
const outdoor: GalleryFolder = { id: 'out', name: 'Ngoài trời', items: [] };

function Harness({
  initial,
  uploadImage = async () => 'https://cdn.example.com/new.jpg',
}: {
  initial: GalleryDraft;
  uploadImage?: (file: File) => Promise<string>;
}) {
  const [draft, setDraft] = useState(initial);
  const folder = draft.gallery.find((f) => f.id === 'rooms');
  if (!folder) return null;
  return (
    <>
      <FolderView
        draft={draft}
        folder={folder}
        canEdit
        onChange={(fn) => setDraft((d) => fn(d))}
        onBack={() => {}}
        uploadImage={uploadImage}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as GalleryDraft;
const start = () => render(<Harness initial={{ gallery: [rooms, outdoor], galleryCover: '' }} />);

describe('FolderView', () => {
  it('numbers the photos only and marks the first 8 photos as sent first', () => {
    start();
    expect(screen.getByText(/Bot gửi trước 8 ảnh đầu theo thứ tự này/)).toBeInTheDocument();
    const tiles = screen.getAllByTestId('media-tile');
    expect(tiles).toHaveLength(11);
    expect(within(tiles[0]!).getByText('1')).toBeInTheDocument();
    expect(within(tiles[1]!).getByText('Video')).toBeInTheDocument();
    expect(within(tiles[2]!).getByText('2')).toBeInTheDocument();
    expect(tiles.filter((t) => t.dataset.early === 'true')).toHaveLength(8);
    expect(tiles[1]?.dataset.early).toBeUndefined();
    expect(tiles[9]?.dataset.early).toBeUndefined();
    expect(screen.getAllByText('Bot gửi trước')).toHaveLength(1);
  });

  it('reorders with the menu, moves a photo to another folder and sets the cover', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Lên' }));
    expect(
      current()
        .gallery[0]?.items.slice(0, 3)
        .map((i) => i.kind),
    ).toEqual(['image', 'image', 'video']);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Chuyển sang thư mục…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ngoài trời' }));
    expect(current().gallery[1]?.items).toEqual([img(1)]);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Ảnh 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đặt làm ảnh bìa' }));
    expect(current().galleryCover).toBe(img(2).url);
  });

  it('removes several selected items at once', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Ảnh 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Tour' }));
    expect(screen.getByText('Đã chọn 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(current().gallery[0]?.items).toHaveLength(9);
  });

  it('adds a video link only when it is https', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'Thêm link video' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Link (https)'), 'http://youtu.be/x');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    expect(within(dialog).getByText('Nhập link bắt đầu bằng https://')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Link (https)'));
    await user.type(within(dialog).getByLabelText('Link (https)'), 'https://youtu.be/x');
    await user.type(within(dialog).getByLabelText('Tiêu đề'), 'Flycam');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    await waitFor(() =>
      expect(current().gallery[0]?.items.at(-1)).toEqual({
        kind: 'link',
        url: 'https://youtu.be/x',
        caption: 'Flycam',
      }),
    );
  });

  it('uploads picked photos into the open folder', async () => {
    start();
    const file = new File(['x'], 'pool.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('media-file-input'), { target: { files: [file] } });
    await waitFor(() =>
      expect(current().gallery[0]?.items.at(-1)).toEqual({
        kind: 'image',
        url: 'https://cdn.example.com/new.jpg',
        caption: '',
      }),
    );
  });

  it('refuses a video over 25 MB before uploading it', async () => {
    start();
    const big = new File(['x'], 'tour.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('media-file-input'), { target: { files: [big] } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Video quá 25 MB — hãy thêm dưới dạng link YouTube/Drive.',
      ),
    );
    expect(current().gallery[0]?.items).toHaveLength(11);
  });

  it('takes a file drop on a full property without opening it, toasts and uploads nothing', () => {
    const uploadImage = vi.fn(async () => 'https://cdn.example.com/new.jpg');
    const full: GalleryFolder = {
      id: 'rooms',
      name: 'Phòng ngủ',
      items: Array.from({ length: 200 }, (_, i) => img(i + 1)),
    };
    render(
      <Harness
        initial={{ gallery: [full, outdoor], galleryCover: '' }}
        uploadImage={uploadImage}
      />,
    );
    const zone = screen.getByTestId('media-drop-zone');
    const file = new File(['x'], 'pool.jpg', { type: 'image/jpeg' });
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'copy' };
    // A drag whose effect is 'none' never gets a drop event in a real browser.
    expect(fireEvent.dragOver(zone, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(fireEvent.drop(zone, { dataTransfer })).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Căn hộ đã đủ 200 mục');
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
