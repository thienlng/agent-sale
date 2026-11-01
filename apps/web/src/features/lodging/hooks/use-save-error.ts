import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { useWorkspaceId } from '@/lib/use-workspace';

import { lodgingConflict } from '../api/bookings';
import { lodgingKeys } from '../api/keys';

/**
 * Toast for a failed property save. `STALE_VERSION` (someone else saved first) says
 * "Dữ liệu đã thay đổi, tải lại" and refetches; `conflict` maps other 409s of the tab
 * (taken code, rooms with bookings); 400 shows the editor's generic message.
 */
export function useSaveError() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  return (error: unknown, conflict?: (codes: string[]) => string) => {
    const { reason, codes } = lodgingConflict(error);
    if (reason === 'STALE_VERSION') {
      toast.error(t('lodging.editor.stale'));
      void qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) });
      return;
    }
    if (conflict && error instanceof ApiClientError && error.code === 'CONFLICT') {
      toast.error(conflict(codes));
      return;
    }
    toast.error(
      error instanceof ApiClientError && error.code === 'VALIDATION_FAILED'
        ? t('lodging.editor.error')
        : errorMessage(t, error),
    );
  };
}
