import type { GalleryFolder } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import type { GalleryDraft } from '../../lib/gallery-model';
import { FolderList } from './folder-list';

beforeAll(() => {
  // Radix menus use pointer capture, which jsdom lacks.
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
  caption: '',
};
const rooms: GalleryFolder = { id: 'rooms', name: 'Phòng ngủ', items: [img(1), img(2), VIDEO] };
const outdoor: GalleryFolder = { id: 'out', name: 'Ngoài trời', items: [] };

function Harness({ initial }: { initial: GalleryDraft }) {
  const [draft, setDraft] = useState(initial);
  const [opened, setOpened] = useState('');
  return (
    <>
      <FolderList
        draft={draft}
        canEdit
        onChange={(fn) => setDraft((d) => fn(d))}
        onOpen={setOpened}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
      <output data-testid="opened">{opened}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as GalleryDraft;

describe('FolderList', () => {
  it('shows the empty state and creates folders, refusing a duplicate name', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ gallery: [], galleryCover: '' }} />);
    expect(screen.getByText(/Chưa có thư mục nào/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), 'Phòng ngủ');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    expect(current().gallery.map((f) => f.name)).toEqual(['Phòng ngủ']);
    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), ' phòng NGỦ ');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    expect(within(dialog).getByText('Đã có thư mục tên này.')).toBeInTheDocument();
    expect(current().gallery).toHaveLength(1);
  });

  it('shows counts and the cover, reorders, renames and opens folders', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ gallery: [rooms, outdoor], galleryCover: '' }} />);
    expect(screen.getByText('2 ảnh · 1 video')).toBeInTheDocument();
    expect(screen.getByText('Thư mục trống')).toBeInTheDocument();
    expect(
      screen.getByText('Tự động: ảnh đầu tiên của thư mục đầu tiên có ảnh'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Ngoài trời' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Lên' }));
    expect(current().gallery.map((f) => f.id)).toEqual(['out', 'rooms']);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Ngoài trời' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đổi tên' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Tên thư mục');
    expect(input).toHaveValue('Ngoài trời');
    await user.clear(input);
    await user.type(input, 'Sân vườn');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(current().gallery[0]?.name).toBe('Sân vườn');
    await user.click(screen.getByRole('button', { name: 'Mở thư mục Phòng ngủ' }));
    expect(screen.getByTestId('opened')).toHaveTextContent('rooms');
  });

  it('asks before deleting a folder with items and deletes an empty one at once', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ gallery: [rooms, outdoor], galleryCover: '' }} />);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Ngoài trời' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá thư mục' }));
    expect(current().gallery.map((f) => f.id)).toEqual(['rooms']);
    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn thư mục Phòng ngủ' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá thư mục' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('Xoá thư mục "Phòng ngủ"?')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Xoá' }));
    expect(current().gallery).toEqual([]);
  });
});
