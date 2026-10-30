import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/lib/api-client';
import { renderWithProviders as render } from '@/testing/render';

import type * as ResizeModule from '../lib/resize-image';
import type * as CommerceApi from '../api/commerce';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  resize: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: mocks.toastError, warning: mocks.toastWarning } }));
vi.mock('../lib/resize-image', async (orig) => ({
  ...(await orig<typeof ResizeModule>()),
  resizeImage: mocks.resize,
}));
vi.mock('../api/commerce', async (orig) => ({
  ...(await orig<typeof CommerceApi>()),
  useUploadProductImage: () => ({ mutateAsync: mocks.mutateAsync }),
}));

import { ImageUnreadableError } from '../lib/resize-image';
import { moveItem, ProductImagesEditor } from './product-images-editor';

function Harness({ initial = [] as string[] }) {
  const [urls, setUrls] = useState(initial);
  return (
    <>
      <ProductImagesEditor value={urls} onChange={setUrls} />
      <output>{JSON.stringify(urls)}</output>
    </>
  );
}

const urls = () => JSON.parse(screen.getByRole('status').textContent ?? '[]') as string[];
const pick = (...names: string[]) =>
  fireEvent.change(screen.getByTestId('image-file-input'), {
    target: { files: names.map((n) => new File(['x'], n, { type: 'image/png' })) },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resize.mockResolvedValue({ mimeType: 'image/jpeg', base64: 'QUJD' });
});

describe('moveItem', () => {
  it('swaps neighbours and ignores the edges', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});

describe('ProductImagesEditor', () => {
  it('has no link input', () => {
    render(<Harness />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByTestId('image-file-input')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
  });

  it('uploads two files one by one and shows two thumbnails', async () => {
    mocks.mutateAsync
      .mockResolvedValueOnce('https://s3.test/products/w/1.jpg')
      .mockResolvedValueOnce('https://s3.test/products/w/2.jpg');
    render(<Harness />);
    pick('a.png', 'b.png');
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ mimeType: 'image/jpeg', base64: 'QUJD' });
    expect(urls()).toEqual([
      'https://s3.test/products/w/1.jpg',
      'https://s3.test/products/w/2.jpg',
    ]);
  });

  it('removes and reorders existing pictures', () => {
    render(
      <Harness
        initial={['https://a.test/1.jpg', 'https://a.test/2.jpg', 'https://a.test/3.jpg']}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /move image 1 right|dời ảnh 1 sang phải/i }),
    );
    expect(urls()).toEqual([
      'https://a.test/2.jpg',
      'https://a.test/1.jpg',
      'https://a.test/3.jpg',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /remove image 1|bỏ ảnh 1/i }));
    expect(urls()).toEqual(['https://a.test/1.jpg', 'https://a.test/3.jpg']);
  });

  it('ignores files beyond the free slots with a toast', async () => {
    mocks.mutateAsync.mockResolvedValue('https://s3.test/products/w/new.jpg');
    render(<Harness initial={['u1', 'u2', 'u3', 'u4'].map((n) => `https://a.test/${n}.jpg`)} />);
    pick('a.png', 'b.png');
    await waitFor(() => expect(urls()).toHaveLength(5));
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.toastWarning).toHaveBeenCalled();
  });

  it('toasts the server reason and keeps earlier uploads', async () => {
    mocks.mutateAsync
      .mockResolvedValueOnce('https://s3.test/products/w/1.jpg')
      .mockRejectedValueOnce(
        new ApiClientError(400, 'VALIDATION_FAILED', 'bad', undefined, { reason: 'INVALID_IMAGE' }),
      );
    render(<Harness />);
    pick('a.png', 'b.png');
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(urls()).toEqual(['https://s3.test/products/w/1.jpg']));
  });

  it('toasts unreadable pictures', async () => {
    mocks.resize.mockRejectedValue(new ImageUnreadableError());
    render(<Harness />);
    pick('a.heic');
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
