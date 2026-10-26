import type { ActionDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';

import { useActions, useDeleteAction, useToggleAction } from '../api/actions';
import { OptionSelect } from './action-fields';

type StatusFilter = 'all' | 'enabled' | 'disabled';

export function filterActions(actions: ActionDto[], query: string, status: StatusFilter) {
  const q = query.trim().toLowerCase();
  return actions.filter(
    (a) =>
      (q === '' || a.name.toLowerCase().includes(q)) &&
      (status === 'all' || (status === 'enabled') === a.enabled),
  );
}

/** "Hành động API" page: what the bot may call, with a quick on/off switch per action. */
export function ActionList({ botId }: { botId: string }) {
  const { t } = useTranslation('action');
  const { t: common } = useTranslation();
  const actions = useActions(botId);
  const toggle = useToggleAction(botId);
  const remove = useDeleteAction(botId);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [deleting, setDeleting] = useState<ActionDto | null>(null);

  const all = actions.data ?? [];
  const visible = filterActions(all, query, status);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link to="/app/bots/$botId/actions/new" params={{ botId }}>
            <Plus />
            {t('add')}
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="action-search">{t('searchLabel')}</Label>
          <Input
            id="action-search"
            type="search"
            value={query}
            placeholder={t('search')}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 sm:w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('filter.label')}</Label>
          <OptionSelect
            label={t('filter.label')}
            value={status}
            options={(['all', 'enabled', 'disabled'] as const).map((v) => ({
              value: v,
              label: t(`filter.${v}`),
            }))}
            onChange={setStatus}
            className="h-9 w-40"
          />
        </div>
      </div>

      {actions.isPending ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : actions.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('loadError')}</p>
          <Button variant="outline" onClick={() => void actions.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
          <Zap aria-hidden className="size-8 text-muted-foreground" />
          <p className="font-medium">{all.length === 0 ? t('empty') : t('noMatch')}</p>
          {all.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyHint')}</p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.name')}</TableHead>
                <TableHead className="w-28">{t('col.method')}</TableHead>
                <TableHead>{t('col.url')}</TableHead>
                <TableHead className="w-28 text-center">{t('col.status')}</TableHead>
                <TableHead className="w-28 text-center">{t('col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium break-words whitespace-normal">
                    {a.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.method}</Badge>
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground" title={a.url}>
                    {a.url}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-center">
                      <Switch
                        aria-label={t('toggle', { name: a.name })}
                        checked={a.enabled}
                        disabled={toggle.isPending}
                        onCheckedChange={(enabled) =>
                          toggle.mutate(
                            { id: a.id, enabled },
                            { onError: (error) => toast.error(errorMessage(common, error)) },
                          )
                        }
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-center">
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          to="/app/bots/$botId/actions/$actionId"
                          params={{ botId, actionId: a.id }}
                          aria-label={t('edit', { name: a.name })}
                        >
                          <Pencil />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('delete', { name: a.name })}
                        onClick={() => setDeleting(a)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(t('deleted')),
                  onError: (error) => toast.error(errorMessage(common, error)),
                });
                setDeleting(null);
              }}
            >
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
