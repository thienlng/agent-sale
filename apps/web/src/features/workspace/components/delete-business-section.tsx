import { BUSINESS_RESTORE_DAYS } from '@agent-sales/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { reloadSession, useSession } from '@/lib/session';

import { useDeleteBusiness } from '../api/business-deletion';

/**
 * Danger zone of the business data page (SET-10, ADR-033): the owner deletes the current business
 * after typing its name. It stops at once (bot, care, channels, access) and can be restored for
 * 30 days from "Business của tôi"; `exportAnchor` links to the data export on the same page.
 */
export function DeleteBusinessSection({ exportAnchor }: { exportAnchor?: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const current = session?.memberships.find((m) => m.workspaceId === session.workspaceId);
  const [open, setOpen] = useState(false);
  if (!current) return null;
  const days = BUSINESS_RESTORE_DAYS;
  const isOwner = current.role === 'owner';

  return (
    <section
      aria-labelledby="delete-business-title"
      className="flex max-w-3xl flex-col gap-3 rounded-xl border border-destructive/40 p-4"
    >
      <div>
        <h2 id="delete-business-title" className="font-semibold text-destructive">
          {t('business.delete.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('business.delete.hint', { days })}</p>
      </div>
      <div className="text-sm">
        <p className="font-medium">{t('business.delete.stopsTitle')}</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          <li>{t('business.delete.points.bot')}</li>
          <li>{t('business.delete.points.care')}</li>
          <li>{t('business.delete.points.channels')}</li>
          <li>{t('business.delete.points.access')}</li>
        </ul>
      </div>
      <p className="text-sm">
        {t('business.delete.exportFirst')}{' '}
        {exportAnchor ? (
          <a href={`#${exportAnchor}`} className="font-medium text-brand-text hover:underline">
            {t('business.delete.exportLink')}
          </a>
        ) : null}
      </p>
      {isOwner ? (
        <div>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 aria-hidden />
            {t('business.delete.action')}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('business.delete.ownerOnly')}</p>
      )}
      {isOwner ? (
        <DeleteBusinessDialog
          open={open}
          onOpenChange={setOpen}
          workspaceId={current.workspaceId}
          name={current.workspaceName}
        />
      ) : null}
    </section>
  );
}

function DeleteBusinessDialog({
  open,
  onOpenChange,
  workspaceId,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  name: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const remove = useDeleteBusiness();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const matches = typed.trim() === name.trim();
  const days = BUSINESS_RESTORE_DAYS;

  const close = (next: boolean) => {
    if (remove.isPending) return;
    if (!next) {
      setTyped('');
      setError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!matches) {
      setError(t('business.delete.mismatch'));
      return;
    }
    remove.mutate(
      { workspaceId, confirmName: typed },
      {
        onSuccess: async () => {
          onOpenChange(false);
          toast.success(t('business.delete.done', { name, days }));
          // Leave the business pages first, so nothing still asks for the deleted business, then
          // reload the memberships (the deleted one is gone; a remembered choice of it is ignored)
          // and drop every cached read of it.
          await navigate({ to: '/app/businesses', search: {} });
          await reloadSession().catch(() => undefined);
          client.removeQueries({ queryKey: ['ws', workspaceId] });
        },
        onError: (err) => {
          const mismatch =
            err instanceof ApiClientError && err.details?.['reason'] === 'name_mismatch';
          setError(mismatch ? t('business.delete.mismatch') : errorMessage(t, err));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('business.delete.dialogTitle', { name })}</DialogTitle>
            <DialogDescription>{t('business.delete.dialogBody', { days })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>{t('business.delete.confirmLabel')}</Label>
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              aria-describedby={hintId}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              {t('business.delete.confirmHint', { name })}
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={remove.isPending}>
                {t('business.delete.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!matches || remove.isPending}>
              {remove.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {t('business.delete.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
