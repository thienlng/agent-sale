import type { SeatUsage } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** The plan has no free member seat: say why and what frees one (no dead-end button). */
export function QuotaDialog({
  open,
  seats,
  onClose,
}: {
  open: boolean;
  seats: SeatUsage | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('team.quota.title')}</DialogTitle>
          <DialogDescription>
            {t('team.quota.body', {
              limit: seats?.limit ?? 0,
              members: seats?.used ?? 0,
              pending: seats?.pending ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t('team.quota.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
