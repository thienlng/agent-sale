import type { LlmProviderDto, LlmProviderKind, LlmProviderOptions } from '@agent-sales/contracts';
import { Eye, EyeOff, Plug } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/errors';

import { useDiscoverModels, useSaveProvider } from '../api/llm';

const NAME = /^[a-z][a-z0-9-]{1,39}$/;

/** Add or edit an AI server. The API key is write-only: empty keeps the stored one. */
export function ProviderDialog({
  open,
  provider,
  onOpenChange,
}: {
  open: boolean;
  provider: LlmProviderDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const save = useSaveProvider();
  const check = useDiscoverModels();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LlmProviderKind>('openai_compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [options, setOptions] = useState<LlmProviderOptions>({
    structuredOutput: 'json_schema',
    sendReasoningEffort: false,
    timeoutMs: 20_000,
  });
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(provider?.name ?? '');
    setKind(provider?.kind ?? 'openai_compatible');
    setBaseUrl(provider?.baseUrl ?? '');
    setApiKey('');
    setRemoveKey(false);
    setShowKey(false);
    setOptions(
      provider?.options ?? {
        structuredOutput: 'json_schema',
        sendReasoningEffort: false,
        timeoutMs: 20_000,
      },
    );
    setIsEnabled(provider?.isEnabled ?? true);
    check.reset();
  }, [open, provider]);

  const nameError = !provider && name && !NAME.test(name) ? t('errors.invalidName') : null;
  const urlError = baseUrl && !/^https?:\/\/\S+$/.test(baseUrl) ? t('errors.invalidUrl') : null;
  const needsUrl = (kind === 'openai_compatible' || kind === 'hermes') && !baseUrl;
  const valid = (provider || NAME.test(name)) && !urlError && !needsUrl;

  function checkConnection() {
    check.mutate({
      ...(provider ? { providerId: provider.id } : {}),
      kind: provider?.kind ?? kind,
      baseUrl: baseUrl || null,
      ...(apiKey && !removeKey ? { apiKey } : {}),
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const done = {
      onSuccess: () => {
        toast.success(t('admin.saved'));
        onOpenChange(false);
      },
      onError: (err: Error) => toast.error(errorMessage(t, err)),
    };
    if (provider) {
      save.mutate(
        {
          id: provider.id,
          change: {
            baseUrl: baseUrl || null,
            ...(removeKey ? { apiKey: null } : apiKey ? { apiKey } : {}),
            options,
            isEnabled,
          },
        },
        done,
      );
    } else {
      save.mutate(
        {
          create: {
            name,
            kind,
            ...(baseUrl ? { baseUrl } : {}),
            ...(apiKey ? { apiKey } : {}),
            options,
            isEnabled,
          },
        },
        done,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{provider ? provider.name : t('admin.addProvider')}</DialogTitle>
            <DialogDescription>{t('admin.apiKeyHint')}</DialogDescription>
          </DialogHeader>

          {!provider ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="p-name">{t('admin.providerName')}</Label>
                <Input
                  id="p-name"
                  value={name}
                  onChange={(e) => setName(e.target.value.trim())}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby="p-name-hint"
                  className="h-10"
                />
                <p
                  id="p-name-hint"
                  className={
                    nameError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                  }
                >
                  {nameError ?? t('admin.providerNameHint')}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="p-kind">{t('admin.kind')}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as LlmProviderKind)}>
                  <SelectTrigger id="p-kind" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai_compatible">
                      {t('admin.kinds.openai_compatible')}
                    </SelectItem>
                    <SelectItem value="anthropic">{t('admin.kinds.anthropic')}</SelectItem>
                    <SelectItem value="hermes">{t('admin.kinds.hermes')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="p-url">{t('admin.baseUrl')}</Label>
            <Input
              id="p-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value.trim())}
              placeholder={
                kind === 'hermes'
                  ? 'http://127.0.0.1:8788'
                  : kind === 'openai_compatible'
                    ? 'http://vllm:8000/v1'
                    : 'https://api.anthropic.com'
              }
              aria-invalid={Boolean(urlError)}
              aria-describedby="p-url-hint"
              className="h-10 font-mono text-sm"
            />
            <p
              id="p-url-hint"
              className={urlError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
            >
              {urlError ?? t('admin.baseUrlHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="p-key">{t('admin.apiKey')}</Label>
            <div className="flex gap-1">
              <Input
                id="p-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                disabled={removeKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  provider?.apiKeyHint ? t('admin.apiKeyKeep', { hint: provider.apiKeyHint }) : ''
                }
                className="h-10 min-w-0 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 shrink-0"
                disabled={removeKey}
                aria-pressed={showKey}
                aria-label={showKey ? t('admin.hideKey') : t('admin.showKey')}
                title={showKey ? t('admin.hideKey') : t('admin.showKey')}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            {provider?.hasApiKey && !apiKey && (baseUrl || null) !== provider.baseUrl ? (
              <p className="text-sm text-warning">{t('admin.baseUrlDropsKey')}</p>
            ) : null}
            {provider?.hasApiKey ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={removeKey}
                  onChange={(e) => setRemoveKey(e.target.checked)}
                />
                {t('admin.removeKey')}
              </label>
            ) : null}
          </div>

          {kind === 'openai_compatible' ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="p-structured">{t('admin.structuredOutput')}</Label>
                <Select
                  value={options.structuredOutput}
                  onValueChange={(v) =>
                    setOptions((o) => ({
                      ...o,
                      structuredOutput: v as LlmProviderOptions['structuredOutput'],
                    }))
                  }
                >
                  <SelectTrigger id="p-structured" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['json_schema', 'json_object', 'none'] as const).map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`admin.structuredOptions.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="p-timeout">{t('admin.timeoutMs')}</Label>
                <Input
                  id="p-timeout"
                  type="number"
                  min={1000}
                  max={120000}
                  step={1000}
                  value={options.timeoutMs}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, timeoutMs: Number(e.target.value) || 20_000 }))
                  }
                  className="h-10"
                />
              </div>
              <label className="flex items-center gap-3 text-sm sm:col-span-2">
                <Switch
                  checked={options.sendReasoningEffort}
                  onCheckedChange={(v) => setOptions((o) => ({ ...o, sendReasoningEffort: v }))}
                />
                {t('admin.sendReasoningEffort')}
              </label>
            </div>
          ) : null}

          <label className="flex items-center gap-3 text-sm">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            {isEnabled ? t('admin.enabled') : t('admin.disabled')}
          </label>

          {kind !== 'hermes' ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(urlError) || needsUrl || check.isPending}
                  onClick={checkConnection}
                >
                  <Plug />
                  {check.isPending ? t('admin.checking') : t('admin.checkConnection')}
                </Button>
                <span className="text-sm text-muted-foreground">{t('admin.checkHint')}</span>
              </div>
              {check.data ? (
                <p
                  role="status"
                  className={
                    check.data.ok ? 'text-sm text-success' : 'text-sm break-words text-destructive'
                  }
                >
                  {check.data.ok
                    ? t('admin.checkOk', {
                        count: check.data.models.length,
                        ms: check.data.latencyMs,
                      })
                    : t('admin.testFail', { error: check.data.error })}
                </p>
              ) : check.isError ? (
                <p role="status" className="text-sm text-destructive">
                  {errorMessage(t, check.error)}
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('admin.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {t('admin.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
