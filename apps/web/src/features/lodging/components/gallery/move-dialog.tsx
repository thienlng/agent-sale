import type { GalleryFolder } from '@agent-sales/contracts';
import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** "Chuyển sang thư mục…": pick the folder the selected items move to (appended at its end). */
export function MoveDialog({
  open,
  onOpenChange,
  folders,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: readonly GalleryFolder[];
  onPick: (folderId: string) => void;
}) {
  const { t } = useTranslation('lodging');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('media.moveTitle')}</DialogTitle>
        </DialogHeader>
        {folders.length ? (
          <ul className="grid gap-1">
            {folders.map((f) => (
              <li key={f.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => onPick(f.id)}
                >
                  <Folder aria-hidden />
                  {f.name}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('media.noOtherFolder')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
