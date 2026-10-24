import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useProviderModels } from '../api/llm';

/**
 * Picks a model from the provider's fetched list. The saved value is always
 * selectable; when the list cannot be fetched (or is empty) it degrades to a
 * free-text input so nothing is blocked.
 */
export function ModelPicker({
  providerId,
  value,
  onChange,
  label,
  id,
  disabled,
}: {
  providerId: string | null;
  value: string;
  onChange: (model: string) => void;
  /** Accessible name of the field. */
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const models = useProviderModels(providerId);
  const ids = models.data?.data.map((m) => m.id) ?? [];
  const state = models.data?.state;
  const useSelect = !models.isError && state === 'ok' && ids.length > 0;
  const options = value && !ids.includes(value) ? [value, ...ids] : ids;
  const note = !providerId
    ? null
    : state === 'auth_required'
      ? t('admin.models.authRequired')
      : models.isError || state === 'unavailable' || (state === 'ok' && ids.length === 0)
        ? t('admin.models.manual')
        : null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1">
        {useSelect ? (
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} aria-label={label} className="w-full min-w-0 font-mono text-sm">
              <SelectValue placeholder={t('admin.models.choose')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-sm">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={id}
            aria-label={label}
            placeholder={t('admin.model')}
            disabled={disabled}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-sm"
          />
        )}
        {providerId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t('admin.models.refresh')}
            title={t('admin.models.refresh')}
            disabled={disabled || models.isFetching}
            onClick={() => void models.refetch()}
          >
            <RefreshCw className={models.isFetching ? 'animate-spin' : undefined} aria-hidden />
          </Button>
        ) : null}
      </div>
      {note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}
