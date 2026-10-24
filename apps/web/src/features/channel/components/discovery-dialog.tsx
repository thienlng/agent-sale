import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useDiscovery } from '../api/channels';

/** Lets the user pick which discovered pages/accounts to connect after the OAuth popup. */
export function DiscoveryDialog({
  discoveryId,
  saving,
  onClose,
  onSave,
}: {
  discoveryId: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (externalIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const discovery = useDiscovery(discoveryId);
  const [selected, setSelected] = useState<string[]>([]);
  const [shownFor, setShownFor] = useState(discoveryId);
  if (shownFor !== discoveryId) {
    setShownFor(discoveryId);
    setSelected([]);
  }
  return (
    <Dialog
      open={Boolean(discoveryId)}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('choose')}</DialogTitle>
          <DialogDescription>{tr('selectAccounts')}</DialogDescription>
        </DialogHeader>
        {discovery.isPending ? (
          <Skeleton className="h-24" />
        ) : discovery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {tr('connectionError')}
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {discovery.data?.accounts.map((a) => (
              <Label
                key={a.externalId}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-4"
              >
                <Checkbox
                  checked={selected.includes(a.externalId)}
                  onCheckedChange={(checked) =>
                    setSelected((prev) =>
                      checked ? [...prev, a.externalId] : prev.filter((id) => id !== a.externalId),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.externalId}
                  </span>
                </span>
              </Label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {tr('cancel')}
          </Button>
          <Button
            disabled={saving || !selected.length || discovery.isError}
            onClick={() => onSave(selected)}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            {tr('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
