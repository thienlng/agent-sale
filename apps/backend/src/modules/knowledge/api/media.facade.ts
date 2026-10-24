import type { TrainingItemDto, UploadBotImageRequest } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** The caller verifies bot ownership before uploading. Public bot marketing images only. */
export interface MediaFacade {
  upload(
    workspaceId: WorkspaceId,
    botId: string,
    input: UploadBotImageRequest,
  ): Promise<TrainingItemDto>;
}
export const MEDIA_FACADE = Symbol('MEDIA_FACADE');
