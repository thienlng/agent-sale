import { type GalleryItem, LODGING_VIDEO_MAX_BYTES } from '@agent-sales/contracts';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useUploadLodgingVideo, videoUploadErrorKey } from '../api/media';
import { type GalleryImageUpload, GalleryUploadError } from '../lib/gallery-model';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** What the "Thêm ảnh/video" picker offers (WebP is converted to JPEG by the image upload). */
export const MEDIA_ACCEPT = [...IMAGE_TYPES, 'video/mp4'].join(',');

export interface UploadEntry {
  id: number;
  name: string;
  kind: 'image' | 'video';
  /** 0..1 for videos (XHR progress); images show a spinner only. */
  progress: number;
}

/**
 * Uploads picked or dropped files one after another: photos through the route's `uploadImage`
 * (commerce's resize + store), MP4 videos through the lodging video route with progress. Every
 * finished file is handed to `onItems` at once, so a later failure keeps the earlier ones.
 */
export function useMediaUpload({
  uploadImage,
  remaining,
  onItems,
}: {
  uploadImage?: GalleryImageUpload | undefined;
  remaining: number;
  onItems: (items: GalleryItem[]) => void;
}) {
  const { t } = useTranslation('lodging');
  const uploadVideo = useUploadLodgingVideo();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const seq = useRef(0);
  // Files accepted but not finished yet: a second batch must not count their slots as free.
  const inFlight = useRef(0);
  // `remaining` as of the last render; lowered at once when a file lands, before the re-render.
  const room = useRef(remaining);
  room.current = remaining;

  const upload = useCallback(
    async (files: File[]) => {
      const notMp4 = files.filter((f) => f.type.startsWith('video/') && f.type !== 'video/mp4');
      if (notMp4.length) toast.error(t('media.videoInvalid'));
      const supported = files.filter((f) => IMAGE_TYPES.includes(f.type) || f.type === 'video/mp4');
      const accepted = supported.slice(0, Math.max(0, room.current - inFlight.current));
      inFlight.current += accepted.length;
      const skipped = files.length - notMp4.length - accepted.length;
      if (skipped > 0) toast.warning(t('media.skipped', { count: skipped }));
      for (const file of accepted) {
        const id = ++seq.current;
        const kind = file.type === 'video/mp4' ? 'video' : 'image';
        setEntries((all) => [...all, { id, name: file.name, kind, progress: 0 }]);
        try {
          if (kind === 'video') {
            if (file.size > LODGING_VIDEO_MAX_BYTES)
              throw new GalleryUploadError(t('media.videoTooLarge'));
            const stored = await uploadVideo(file, (progress) =>
              setEntries((all) => all.map((e) => (e.id === id ? { ...e, progress } : e))),
            );
            room.current -= 1;
            onItems([{ kind: 'video', url: stored.url, caption: '' }]);
          } else {
            if (!uploadImage) throw new GalleryUploadError(t('media.uploadFailed'));
            const url = await uploadImage(file);
            room.current -= 1;
            onItems([{ kind: 'image', url, caption: '' }]);
          }
        } catch (error) {
          toast.error(
            error instanceof GalleryUploadError ? error.message : t(videoUploadErrorKey(error)),
          );
        } finally {
          inFlight.current -= 1;
          setEntries((all) => all.filter((e) => e.id !== id));
        }
      }
    },
    [onItems, t, uploadImage, uploadVideo],
  );

  return { entries, upload };
}
