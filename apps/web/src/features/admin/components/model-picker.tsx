import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { useDiscoverModels } from '../api/llm';

/**
 * A model id field with a button that fetches the server's model list. Typing stays possible for
 * servers that cannot list models (Hermes) or models that are not listed.
 */
export function ModelPicker({
  id,
  label,
  providerId,
  value,
  onChange,
  canList,
}: {
  id: string;
  label: string;
  providerId: string | undefined;
  value: string;
  onChange: (model: string) => void;
  canList: boolean;
}) {
  const { t } = useTranslation();
  const discover = useDiscoverModels();
  const [filter, setFilter] = useState('');

  function load() {
    if (providerId) discover.mutate({ providerId });
  }

  const models = (discover.data?.models ?? []).filter((m) =>
    m.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="flex min-w-0 gap-1">
      <Input
        id={id}
        aria-label={label}
        placeholder={t('admin.model')}
        disabled={!providerId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 font-mono text-sm"
      />
      {canList ? (
        <Popover
          onOpenChange={(open) => {
            if (!open) return;
            setFilter('');
            load();
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!providerId}
              aria-label={t('admin.fetchModels')}
              title={t('admin.fetchModels')}
              className="shrink-0"
            >
              <ChevronsUpDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            {discover.isPending ? (
              <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t('admin.fetchingModels')}
              </p>
            ) : discover.data && !discover.data.ok ? (
              <div className="flex flex-col gap-2 p-2">
                <p role="status" className="text-sm break-words text-destructive">
                  {t('admin.testFail', { error: discover.data.error })}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={load}>
                  {t('admin.retry')}
                </Button>
              </div>
            ) : discover.data ? (
              <div className="flex flex-col gap-2">
                <Input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('admin.filterModels', { count: discover.data.models.length })}
                  className="h-9"
                />
                <ul className="max-h-64 overflow-y-auto">
                  {models.length ? (
                    models.map((m) => (
                      <li key={m}>
                        <button
                          type="button"
                          onClick={() => onChange(m)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-sm hover:bg-accent"
                        >
                          <Check
                            className={cn(
                              'size-4 shrink-0',
                              m === value ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{m}</span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="p-2 text-sm text-muted-foreground">{t('admin.noModels')}</li>
                  )}
                </ul>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
