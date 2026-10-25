import type { ActionTestResult } from '@agent-sales/contracts';
import { CircleAlert, CircleCheck, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useTestAction } from '../api/actions';
import { buildArgs, type ParamRow } from '../lib/action-form';
import { OptionSelect } from './action-fields';

const MAX_SHOWN = 2000;

function trimmed(data: unknown): string {
  const text = JSON.stringify(data, null, 2) ?? '';
  return text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN) : text;
}

function Result({ result }: { result: ActionTestResult }) {
  const { t } = useTranslation('action');
  const Icon = result.ok ? CircleCheck : CircleAlert;
  const shown = result.data === null ? null : trimmed(result.data);
  const cut = shown !== null && JSON.stringify(result.data, null, 2).length > MAX_SHOWN;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
      data-ok={result.ok}
    >
      <p
        className={`flex items-center gap-2 font-medium ${result.ok ? 'text-success' : 'text-destructive'}`}
      >
        <Icon aria-hidden className="size-4" />
        {result.ok ? t('test.ok') : t('test.failed')}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('test.status')}</dt>
        <dd>{result.statusCode ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('test.latencyLabel')}</dt>
        <dd>{t('test.latency', { ms: result.latencyMs })}</dd>
      </dl>
      {result.errorCode ? <p>{t(`test.errorCodes.${result.errorCode}`)}</p> : null}
      {shown !== null ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t('test.data')}</p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs break-words whitespace-pre-wrap">
            {shown}
            {cut ? t('test.truncated') : ''}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** "Thử gọi": sample inputs generated from the parameters, one real call, then the outcome. */
export function ActionTestPanel({
  botId,
  actionId,
  params,
}: {
  botId: string;
  /** Absent while the action is not saved yet: the call uses the stored version. */
  actionId: string | undefined;
  params: ParamRow[];
}) {
  const { t } = useTranslation('action');
  const test = useTestAction(botId, actionId ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const named = params.filter((p) => p.name.trim() !== '');

  return (
    <section aria-labelledby="action-test" className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 id="action-test" className="text-sm font-semibold">
          {t('test.title')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {actionId ? t('test.hint') : t('test.saveFirst')}
        </p>
      </div>
      {actionId ? (
        <>
          {named.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('test.noParams')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {named.map((p) => (
                <div key={p.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`test-${p.key}`}>{p.name}</Label>
                  {p.type === 'boolean' ? (
                    <OptionSelect
                      label={p.name}
                      value={(values[p.name] || 'true') as 'true' | 'false'}
                      options={[
                        { value: 'true', label: t('test.yes') },
                        { value: 'false', label: t('test.no') },
                      ]}
                      onChange={(v) => setValues({ ...values, [p.name]: v })}
                    />
                  ) : (
                    <Input
                      id={`test-${p.key}`}
                      inputMode={p.type === 'number' ? 'decimal' : 'text'}
                      value={values[p.name] ?? ''}
                      onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={test.isPending}
            onClick={() => test.mutate(buildArgs(named, values))}
          >
            <Play />
            {test.isPending ? t('test.running') : t('test.run')}
          </Button>
          {test.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t('test.requestFailed')}
            </p>
          ) : null}
          {test.data ? <Result result={test.data} /> : null}
        </>
      ) : null}
    </section>
  );
}
