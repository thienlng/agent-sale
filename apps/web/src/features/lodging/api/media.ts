import { UploadLodgingVideoResponse } from '@agent-sales/contracts';
import { useCallback } from 'react';

import { ApiClientError, apiUpload } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

/** Uploads one MP4 (`POST /lodging/media/videos`); `onProgress` gets 0..1 while it uploads. */
export function useUploadLodgingVideo() {
  const ws = useWorkspaceId();
  return useCallback(
    (file: File, onProgress: (fraction: number) => void): Promise<UploadLodgingVideoResponse> =>
      apiUpload('/lodging/media/videos', UploadLodgingVideoResponse, {
        file,
        fileName: file.name || 'video.mp4',
        workspaceId: ws,
        onProgress: ({ loaded, total }) => onProgress(total ? loaded / total : 0),
      }),
    [ws],
  );
}

/** i18n key for a failed video upload, chosen by the server's `details.reason`. */
export function videoUploadErrorKey(error: unknown) {
  const reason = error instanceof ApiClientError ? error.details?.['reason'] : undefined;
  if (reason === 'VIDEO_TOO_LARGE' || (error instanceof ApiClientError && error.status === 413))
    return 'media.videoTooLarge' as const;
  if (reason === 'INVALID_VIDEO') return 'media.videoInvalid' as const;
  if (reason === 'MEDIA_STORAGE_UNAVAILABLE') return 'media.storageUnavailable' as const;
  return 'media.uploadFailed' as const;
}
