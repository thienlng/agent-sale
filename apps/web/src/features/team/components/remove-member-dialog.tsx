import type { MemberDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useRemovalPreview, useTeamMutations } from '../api/team';

/** Roles that can take customers over (they must be able to work them). */
const CAN_OWN = new Set(['owner', 'admin', 'sales', 'care']);

/**
 * Remove a member. If they own customers, the dialog says how many and requires an
 * explicit choice (hand over to someone, or leave unassigned) before confirming.
 */
export function RemoveMemberDialog({
  member,
  members,
  onClose,
}: {
  member: MemberDto | null;
  members: MemberDto[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const preview = useRemovalPreview(member?.userId);
  const { remove } = useTeamMutations();
  const [mode, setMode] = useState<'transfer' | 'unassign'>('transfer');
  const [to, setTo] = useState('');
  const heirs = members.filter(
    (m) => m.status === 'active' && m.userId !== member?.userId && CAN_OWN.has(m.role),
  );
  const needs = preview.data?.requiresReassignment ?? false;
  const ready = !preview.isPending && (!needs || mode === 'unassign' || to !== '');

  const confirm = () => {
    if (!member) return;
    const body = needs ? { reassign: mode === 'unassign' ? { mode } : { mode, toUserId: to } } : {};
    remove.mutate(
      { userId: member.userId, body: body as never },
      {
        onSuccess: () => {
          toast.success(t('team.removed'));
          onClose();
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  };

  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('team.removeDialog.title', { name: member?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('team.removeDialog.body')}</DialogDescription>
        </DialogHeader>
        {preview.isPending ? (
          <Skeleton className="h-16" aria-label={t('team.removeDialog.loading')} />
        ) : needs ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t('team.removeDialog.owns', {
                name: member?.name ?? '',
                sales: preview.data?.sales ?? 0,
                care: preview.data?.care ?? 0,
              })}
            </p>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'transfer' | 'unassign')}>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="rm-transfer" value="transfer" />
                <Label htmlFor="rm-transfer" className="font-normal">
                  {t('team.removeDialog.transfer')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="rm-unassign" value="unassign" />
                <Label htmlFor="rm-unassign" className="font-normal">
                  {t('team.removeDialog.unassign')}
                </Label>
              </div>
            </RadioGroup>
            {mode === 'transfer' ? (
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger className="w-full" aria-label={t('team.removeDialog.transfer')}>
                  <SelectValue placeholder={t('team.removeDialog.pick')} />
                </SelectTrigger>
                <SelectContent>
                  {heirs.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name} · {t(`team.roles.${m.role}`, { defaultValue: m.role })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('team.cancel')}
          </Button>
          <Button variant="destructive" disabled={!ready || remove.isPending} onClick={confirm}>
            {t('team.removeDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
