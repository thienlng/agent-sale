import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodedBytes, fitWithin, resizeImage } from './resize-image';

describe('fitWithin', () => {
  it('keeps small pictures and scales the longest side down to 1600', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it('never returns a zero side', () => {
    expect(fitWithin(10000, 2)).toEqual({ width: 1600, height: 1 });
  });
});

describe('decodedBytes', () => {
  it('counts bytes behind base64 padding', () => {
    expect(decodedBytes('QUJD')).toBe(3);
    expect(decodedBytes('QUI=')).toBe(2);
    expect(decodedBytes('QQ==')).toBe(1);
  });
});

describe('resizeImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubCanvas(sizes: Record<string, string>) {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const toDataURL = vi.fn((_type: string, q: number) => `data:image/jpeg;base64,${sizes[q]}`);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, fillRect }), toDataURL };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4000, height: 2000, close })),
    );
    return { canvas, drawImage, fillRect, toDataURL, close };
  }

  it('draws at 1600 px on a white background and exports JPEG 0.85', async () => {
    const m = stubCanvas({ 0.85: 'QUJD' });
    const out = await resizeImage(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(out).toEqual({ mimeType: 'image/jpeg', base64: 'QUJD' });
    expect(m.canvas.width).toBe(1600);
    expect(m.canvas.height).toBe(800);
    expect(m.fillRect).toHaveBeenCalled();
    expect(m.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
    expect(m.close).toHaveBeenCalled();
  });

  it('retries once at 0.7 when the result is over 1 MiB', async () => {
    const big = 'A'.repeat(1_500_000);
    const m = stubCanvas({ 0.85: big, 0.7: 'QUJD' });
    const out = await resizeImage(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(out.base64).toBe('QUJD');
    expect(m.toDataURL).toHaveBeenCalledTimes(2);
    expect(m.toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.7);
  });

  it('throws ImageUnreadableError when the browser cannot decode the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    await expect(resizeImage(new File(['x'], 'a.heic'))).rejects.toThrow('IMAGE_UNREADABLE');
  });
});
