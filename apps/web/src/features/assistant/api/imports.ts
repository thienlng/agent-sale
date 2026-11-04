import {
  type CreateImportBatchRequest,
  ImportBatchDto,
  type UploadProductImageRequest,
  UploadProductImageResponse,
} from '@agent-sales/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { assistantKeys } from './assistant';

export const importKeys = {
  batch: (ws: string, batchId: string) => [...assistantKeys.all(ws), 'imports', batchId] as const,
};

/**
 * Starts a product import in a thread: a sheet the browser read, or uploaded photos the server
 * drafts with a vision model (that request can take up to about 55 s).
 */
export function useCreateImportBatch() {
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: ({ threadId, ...body }: CreateImportBatchRequest & { threadId: string }) =>
      api(`/assistant/threads/${threadId}/imports`, ImportBatchDto, {
        method: 'POST',
        body,
        workspaceId: ws,
      }),
  });
}

/** One import batch: its drafts, their problems and the results of approved imports. */
export function useImportBatch(batchId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: importKeys.batch(ws, batchId ?? ''),
    queryFn: ({ signal }) =>
      api(`/assistant/imports/${batchId}`, ImportBatchDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws && batchId),
  });
}

/**
 * Uploads one resized photo to the business's product pictures (the product form's own route,
 * C4-R6); resolves to its `/media/products/…` path.
 */
export function uploadImportPhoto(
  businessId: string,
  body: UploadProductImageRequest,
): Promise<string> {
  return api('/products/images', UploadProductImageResponse, {
    method: 'POST',
    body,
    workspaceId: businessId,
  }).then((r) => r.url);
}
