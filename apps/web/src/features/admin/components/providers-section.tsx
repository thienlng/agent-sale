import type { LlmProviderDto } from '@agent-sales/contracts';
import { KeyRound, MoreHorizontal, Pencil, Plug, Plus, Server, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

import { useDeleteProvider, useLlmProviders, useTestProvider } from '../api/llm';
import { ProviderDialog } from './provider-dialog';

/** Sends a tiny prompt with the stored key; the result shows inline. */
function TestButton({ provider }: { provider: LlmProviderDto }) {
  const { t } = useTranslation();
  const test = useTestProvider();
  const [model, setModel] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (model.trim()) test.mutate({ id: provider.id, model: model.trim() });
  }

  return (
    <Popover onOpenChange={(o) => !o && test.reset()}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plug />
          {t('admin.test')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor={`test-${provider.id}`}>
            {t('admin.testModel')}
          </label>
          <div className="flex gap-2">
            <Input
              id={`test-${provider.id}`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider.kind === 'anthropic' ? 'claude-haiku-5-5' : 'qwen3-32b'}
              className="font-mono text-sm"
            />
            <Button type="submit" disabled={!model.trim() || test.isPending}>
              {t('admin.test')}
            </Button>
          </div>
          {test.data ? (
            <p
              role="status"
              className={
                test.data.ok ? 'text-sm text-success' : 'text-sm break-words text-destructive'
              }
            >
              {test.data.ok
                ? t('admin.testOk', { model: test.data.model, ms: test.data.latencyMs })
                : t('admin.testFail', { error: test.data.error })}
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ProvidersSection() {
  const { t } = useTranslation();
  const providers = useLlmProviders();
  const remove = useDeleteProvider();
  const [editing, setEditing] = useState<LlmProviderDto | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<LlmProviderDto | null>(null);

  const edit = (p: LlmProviderDto | null) => {
    setEditing(p);
    setOpen(true);
  };

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-lg font-semibold">{t('admin.providers')}</h2>
        <Button onClick={() => edit(null)}>
          <Plus />
          {t('admin.addProvider')}
        </Button>
      </header>
      <div className="mt-4">
        {providers.isPending ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : !providers.data?.length ? (
          <p className="rounded-xl border border-dashed px-6 py-10 text-center text-muted-foreground">
            {t('admin.emptyProviders')}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {providers.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <Server className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{p.name}</span>
                    <Badge
                      variant="secondary"
                      className={p.isEnabled ? 'bg-success-soft text-success' : undefined}
                    >
                      {p.isEnabled ? t('admin.enabled') : t('admin.disabled')}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {t(`admin.kinds.${p.kind}`)}
                    {p.baseUrl ? <span className="ml-2 font-mono">{p.baseUrl}</span> : null}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <KeyRound className="size-4" aria-hidden />
                  {p.hasApiKey ? t('admin.keySet', { hint: p.apiKeyHint ?? '' }) : t('admin.noKey')}
                </span>
                <TestButton provider={p} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t('admin.edit')}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => edit(p)}>
                      <Pencil />
                      {t('admin.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(p)}>
                      <Trash2 />
                      {t('admin.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ProviderDialog open={open} provider={editing} onOpenChange={setOpen} />
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('admin.deleteConfirm', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('admin.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(t('admin.deleted')),
                  onError: (err) =>
                    toast.error(
                      err instanceof ApiClientError && err.code === 'CONFLICT'
                        ? t('errors.inUse')
                        : errorMessage(t, err),
                    ),
                });
                setDeleting(null);
              }}
            >
              {t('admin.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
