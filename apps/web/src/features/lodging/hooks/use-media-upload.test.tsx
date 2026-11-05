import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Providers } from '@/app/providers';
import { loadNamespace } from '@/lib/i18n';

import { useMediaUpload } from './use-media-upload';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));

beforeAll(() => loadNamespace('lodging'));

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('useMediaUpload', () => {
  it('counts uploads still in flight against the item cap and refuses the overflow up-front', async () => {
    const pending: ((url: string) => void)[] = [];
    const uploadImage = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
    const onItems = vi.fn();
    const { result } = renderHook(() => useMediaUpload({ uploadImage, remaining: 2, onItems }), {
      wrapper: Providers,
    });

    let first!: Promise<void>;
    act(() => {
      first = result.current.upload([photo('a.jpg'), photo('b.jpg')]);
    });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    // Both slots are taken by the first batch (one uploading, one queued): nothing fits.
    await act(() => result.current.upload([photo('c.jpg')]));
    expect(toast.warning).toHaveBeenCalledWith(
      'Bỏ qua 1 tệp: chỉ nhận ảnh JPEG/PNG/WebP và video MP4, tối đa 200 mục.',
    );

    await act(async () => {
      pending.shift()?.('https://cdn.example.com/a.jpg');
      await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2));
      pending.shift()?.('https://cdn.example.com/b.jpg');
      await first;
    });
    expect(uploadImage).toHaveBeenCalledTimes(2);
    expect(onItems).toHaveBeenCalledTimes(2);
  });
});
