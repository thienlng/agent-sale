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
// Long user-event flows: the default 5 s is too short while the whole gate runs in parallel.
vi.setConfig({ testTimeout: 20_000 });
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
const YT = 'dQw4w9WgXcQ';
const DRIVE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
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

  it('adds a pasted video link as https and refuses what is not a link', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'Thêm link video' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Link video');
    await user.type(field, 'not a link');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    expect(
      within(dialog).getByText('Dán link video, ví dụ youtu.be/… hoặc drive.google.com/…'),
    ).toBeInTheDocument();
    await user.clear(field);
    // No scheme: stored with https://.
    await user.type(field, `youtu.be/${YT}`);
    await user.type(within(dialog).getByLabelText('Tiêu đề'), 'Flycam');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    await waitFor(() =>
      expect(current().gallery[0]?.items.at(-1)).toEqual({
        kind: 'link',
        url: `https://youtu.be/${YT}`,
        caption: 'Flycam',
      }),
    );
    // http:// is upgraded.
    await user.click(screen.getByRole('button', { name: 'Thêm link video' }));
    const again = await screen.findByRole('dialog');
    await user.type(
      within(again).getByLabelText('Link video'),
      `http://drive.google.com/file/d/${DRIVE}/view`,
    );
    await user.click(within(again).getByRole('button', { name: 'Thêm' }));
    await waitFor(() =>
      expect(current().gallery[0]?.items.at(-1)).toEqual({
        kind: 'link',
        url: `https://drive.google.com/file/d/${DRIVE}/view`,
        caption: '',
      }),
    );
  });

  it('shows YouTube and Drive links as videos and plays them in the large view', async () => {
    const user = userEvent.setup();
    const links: GalleryFolder = {
      id: 'rooms',
      name: 'Phòng ngủ',
      items: [
        { kind: 'link', url: `https://www.youtube.com/watch?v=${YT}`, caption: 'Flycam' },
        { kind: 'link', url: `https://drive.google.com/file/d/${DRIVE}/view`, caption: '' },
        { kind: 'link', url: 'https://www.tiktok.com/@villa/video/1', caption: 'TikTok' },
      ],
    };
    render(<Harness initial={{ gallery: [links, outdoor], galleryCover: '' }} />);
    const tiles = screen.getAllByTestId('media-tile');
    expect(within(tiles[0]!).getByRole('img', { name: 'Flycam' })).toHaveAttribute(
      'src',
      `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
    );
    // Badged as videos, with the title and the provider at the bottom.
    expect(within(tiles[0]!).getByText('Video')).toBeInTheDocument();
    expect(within(tiles[0]!).getByText('YouTube')).toBeInTheDocument();
    expect(within(tiles[1]!).getByText('Video')).toBeInTheDocument();
    expect(within(tiles[1]!).getByText('Google Drive')).toBeInTheDocument();
    expect(within(tiles[2]!).queryByRole('img')).not.toBeInTheDocument();
    expect(within(tiles[2]!).getByText('Link')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xem lớn Flycam' }));
    const dialog = await screen.findByRole('dialog');
    const player = within(dialog).getByTitle('Flycam');
    expect(player.tagName).toBe('IFRAME');
    expect(player).toHaveAttribute('src', `https://www.youtube-nocookie.com/embed/${YT}`);
    expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(within(dialog).getByRole('link', { name: 'Mở link (www.youtube.com)' })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${YT}`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mục sau' }));
    expect(within(dialog).getByTitle('drive.google.com')).toHaveAttribute(
      'src',
      `https://drive.google.com/file/d/${DRIVE}/preview`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mục sau' }));
    // Any other link keeps the link card.
    expect(dialog.querySelector('iframe')).toBeNull();
    expect(
      within(dialog).getByRole('link', { name: 'Mở link (www.tiktok.com)' }),
    ).toBeInTheDocument();
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

  it('opens a photo large, steps with the arrows and edits its caption there', async () => {
    const user = userEvent.setup();
    start();
    await user.click(screen.getByRole('button', { name: 'Xem lớn Ảnh 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 / 11')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Ảnh 1' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/1.jpg',
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Chú thích' }), 'Mặt tiền');
    expect(current().gallery[0]?.items[0]?.caption).toBe('Mặt tiền');
    await user.click(within(dialog).getByRole('button', { name: 'Mục sau' }));
    expect(within(dialog).getByText('2 / 11')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Tour')).toHaveAttribute('src', VIDEO.url);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('1 / 11')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('11 / 11')).toBeInTheDocument();
  });

  it('switches to a list with captions edited in place, and remembers the choice', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('rapiz.lodging.mediaView');
    const first = start();
    await user.click(screen.getByRole('radio', { name: 'Dạng danh sách' }));
    const rows = screen.getAllByTestId('media-row');
    expect(rows).toHaveLength(11);
    expect(screen.queryAllByTestId('media-tile')).toHaveLength(0);
    expect(rows.filter((r) => r.dataset.early === 'true')).toHaveLength(8);
    expect(within(rows[1]!).getByRole('textbox', { name: 'Chú thích cho Tour' })).toHaveValue(
      'Tour',
    );
    const caption = within(rows[2]!).getByRole('textbox', { name: 'Chú thích cho Ảnh 2' });
    expect(caption).toHaveAttribute('placeholder', 'Phòng ngủ');
    await user.type(caption, 'Phòng ngủ chính');
    expect(current().gallery[0]?.items[2]?.caption).toBe('Phòng ngủ chính');
    first.unmount();
    start();
    expect(screen.getAllByTestId('media-row')).toHaveLength(11);
    localStorage.removeItem('rapiz.lodging.mediaView');
  });
});
