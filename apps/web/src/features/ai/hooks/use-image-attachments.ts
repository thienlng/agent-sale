import type { PlaygroundImage } from '@agent-sales/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface Attachment {
  id: number;
  file: File;
  /** Object URL for the thumbnail; kept alive while the sent bubble shows it. */
  url: string;
}

export type AttachError = 'tooMany' | 'tooBig' | 'badType';

/** Reads a file as raw base64 (no `data:` prefix). */
export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export async function toPlaygroundImages(items: readonly Attachment[]) {
  return Promise.all(
    items.map(async (a): Promise<PlaygroundImage> => ({
      mimeType: a.file.type as PlaygroundImage['mimeType'],
      base64: await toBase64(a.file),
    })),
  );
}

/** Pending images for the next message plus every object URL created, revoked on reset/unmount. */
export function useImageAttachments() {
  const seq = useRef(0);
  const urls = useRef(new Set<string>());
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<AttachError | null>(null);

  const discardAll = useCallback(() => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current.clear();
    setItems([]);
    setError(null);
  }, []);
  useEffect(() => discardAll, [discardAll]);

  const add = useCallback(
    (files: Iterable<File>) => {
      const incoming = [...files];
      if (!incoming.length) return;
      const bad = incoming.find((f) => !(IMAGE_TYPES as readonly string[]).includes(f.type));
      if (bad) return setError('badType');
      if (incoming.some((f) => f.size > MAX_IMAGE_BYTES)) return setError('tooBig');
      if (items.length + incoming.length > MAX_IMAGES) return setError('tooMany');
      setError(null);
      setItems((cur) => [
        ...cur,
        ...incoming.map((file) => {
          const url = URL.createObjectURL(file);
          urls.current.add(url);
          return { id: ++seq.current, file, url };
        }),
      ]);
    },
    [items.length],
  );

  const remove = useCallback((id: number) => {
    setError(null);
    setItems((cur) => {
      const gone = cur.find((a) => a.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.url);
        urls.current.delete(gone.url);
      }
      return cur.filter((a) => a.id !== id);
    });
  }, []);

  /** Hands the pending images to a sent bubble (URLs stay alive) and empties the composer. */
  const take = useCallback(() => {
    const taken = items;
    setItems([]);
    setError(null);
    return taken;
  }, [items]);

  return { items, error, add, remove, take, discardAll };
}
