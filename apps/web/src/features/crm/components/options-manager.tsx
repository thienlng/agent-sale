import type { CrmOptionDto } from '@agent-sales/contracts';
import { ArchiveRestore, Archive, ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useCrmOptions, useOptionMutations } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';

function OptionRow({
  option,
  index,
  count,
  kind,
  onMove,
}: {
  option: CrmOptionDto;
  index: number;
  count: number;
  kind: 'sources' | 'statuses';
  onMove: (by: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const { update } = useOptionMutations(kind);
  const [name, setName] = useState(option.name);
  const fail = (err: unknown) => toast.error(crmErrorMessage(t, err));
  const save = (body: { name?: string; color?: string; archived?: boolean }) =>
    update.mutate(
      { id: option.id, body },
      { onSuccess: () => toast.success(t('crm.settings.saved')), onError: fail },
    );

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-2 px-3 py-2',
        option.archived && 'bg-muted/40',
      )}
    >
      <input
        type="color"
        aria-label={`${t('crm.settings.color')}: ${option.name}`}
        className="size-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        value={option.color}
        onChange={(e) => save({ color: e.target.value })}
      />
      <Input
        aria-label={option.name}
        className={cn('h-8 min-w-40 flex-1', option.archived && 'text-muted-foreground')}
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== option.name && save({ name: name.trim() })}
      />
      {option.key ? (
        <span className="text-xs text-muted-foreground">{t('crm.settings.default')}</span>
      ) : null}
      {option.archived ? (
        <span className="text-xs text-muted-foreground" title={t('crm.settings.archivedHint')}>
          {t('crm.settings.archived')}
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === 0}
          aria-label={`${option.name}: ${t('crm.settings.moveUp')}`}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === count - 1}
          aria-label={`${option.name}: ${t('crm.settings.moveDown')}`}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => save({ archived: !option.archived })}
          aria-label={`${option.name}: ${t(option.archived ? 'crm.settings.restore' : 'crm.settings.archive')}`}
        >
          {option.archived ? <ArchiveRestore /> : <Archive />}
          <span className="hidden sm:inline">
            {t(option.archived ? 'crm.settings.restore' : 'crm.settings.archive')}
          </span>
        </Button>
      </div>
    </li>
  );
}

/** Customer sources or pipeline statuses: add, rename, recolor, reorder, archive (CRM-03). */
export function OptionsManager({ kind }: { kind: 'sources' | 'statuses' }) {
  const { t } = useTranslation();
  const options = useCrmOptions(kind);
  const { create, reorder } = useOptionMutations(kind);
  const [name, setName] = useState('');
  const list = options.data ?? [];
  const fail = (err: unknown) => toast.error(crmErrorMessage(t, err));

  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((o) => o.id);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j] as string, ids[index] as string];
    reorder.mutate(ids, { onError: fail });
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim() }, { onSuccess: () => setName(''), onError: fail });
  };

  if (!options.data) return <Skeleton className="h-64 rounded-xl" />;
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6">
      <p className="text-sm text-muted-foreground">
        {t(kind === 'statuses' ? 'crm.settings.statusesHint' : 'crm.settings.sourcesHint')}
      </p>
      <ol className="divide-y rounded-lg border">
        {list.map((o, i) => (
          <OptionRow
            key={`${o.id}:${o.name}`}
            option={o}
            index={i}
            count={list.length}
            kind={kind}
            onMove={(by) => move(i, by)}
          />
        ))}
      </ol>
      <form onSubmit={add} className="flex gap-2">
        <Input
          aria-label={t('crm.settings.newName')}
          placeholder={t('crm.settings.newName')}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          <Plus />
          {t('crm.settings.add')}
        </Button>
      </form>
    </div>
  );
}
