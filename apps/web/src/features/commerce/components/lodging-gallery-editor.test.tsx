import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '@/testing/render';

import type * as ResizeModule from '../lib/resize-image';
import type * as CommerceApi from '../api/commerce';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), resize: vi.fn() }));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('../lib/resize-image', async (orig) => ({
  ...(await orig<typeof ResizeModule>()),
  resizeImage: mocks.resize,
}));
vi.mock('../api/commerce', async (orig) => ({
  ...(await orig<typeof CommerceApi>()),
  useUploadProductImage: () => ({ mutateAsync: mocks.mutateAsync }),
}));

import { type GalleryPhoto, LodgingGalleryEditor } from './lodging-gallery-editor';

function Harness({ initial = [] as GalleryPhoto[] }) {
  const [photos, setPhotos] = useState(initial);
  return (
    <>
      <LodgingGalleryEditor value={photos} onChange={setPhotos} />
      <output data-testid="value">{JSON.stringify(photos)}</output>
    </>
  );
}
const photos = () => JSON.parse(screen.getByTestId('value').textContent ?? '[]') as GalleryPhoto[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resize.mockResolvedValue({ mimeType: 'image/jpeg', base64: 'QUJD' });
});

describe('LodgingGalleryEditor', () => {
  it('has no URL input and adds uploaded photos with an empty caption to fill', async () => {
    mocks.mutateAsync
      .mockResolvedValueOnce('https://s3.test/products/w/1.jpg')
      .mockResolvedValueOnce('https://s3.test/products/w/2.jpg');
    render(<Harness />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.change(screen.getByTestId('image-file-input'), {
      target: {
        files: ['a', 'b'].map((n) => new File(['x'], n, { type: 'image/jpeg' })),
      },
    });
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(2));
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText(/caption 1|chú thích.* 1|mô tả ảnh 1/i), {
      target: { value: 'Pool' },
    });
    expect(photos().map((p) => p.caption)).toEqual(['Pool', '']);
    fireEvent.click(
      screen.getAllByRole('button', { name: /remove|bỏ|xóa|xoá/i })[0] as HTMLElement,
    );
    expect(photos()).toHaveLength(1);
  });

  it('keeps a caption typed while an upload is running', async () => {
    let release!: (url: string) => void;
    mocks.mutateAsync.mockImplementationOnce(() => new Promise<string>((r) => (release = r)));
    render(<Harness initial={[{ url: 'https://a.test/1.jpg', caption: '' }]} />);
    fireEvent.change(screen.getByTestId('image-file-input'), {
      target: { files: [new File(['x'], 'a', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/caption 1|mô tả ảnh 1/i), {
      target: { value: 'Pool' },
    });
    release('https://s3.test/products/w/new.jpg');
    await waitFor(() => expect(photos()).toHaveLength(2));
    expect(photos().map((p) => p.caption)).toEqual(['Pool', '']);
  });
});
