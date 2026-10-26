import type { ActionDto, ActionInput, ActionMethod } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';

import { useSaveAction } from '../api/actions';
import {
  confirmDefault,
  formFromDto,
  newForm,
  toInput,
  validateForm,
  type ActionForm as FormState,
} from '../lib/action-form';
import { Field, OptionSelect, useErrorText } from './action-fields';
import { ParamsEditor } from './action-params-editor';
import { ResponsesEditor } from './action-responses-editor';
import { ActionTestPanel } from './action-test-panel';

const METHODS: ActionMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH = [
  ['none', 'form.authNone'],
  ['api_key', 'form.authApiKey'],
  ['bearer', 'form.authBearer'],
] as const;

function AuthFields({
  form,
  set,
  errorText,
}: {
  form: FormState;
  set: (patch: Partial<FormState>) => void;
  errorText: (path: string) => string | undefined;
}) {
  const { t } = useTranslation('action');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label>{t('form.auth')}</Label>
        <OptionSelect
          label={t('form.auth')}
          value={form.authKind}
          options={AUTH.map(([value, label]) => ({ value, label: t(label) }))}
          onChange={(authKind) => set({ authKind })}
        />
      </div>
      {form.authKind === 'api_key' ? (
        <Field id="action-header" label={t('form.headerName')} error={errorText('auth.headerName')}>
          <Input
            id="action-header"
            value={form.headerName}
            onChange={(e) => set({ headerName: e.target.value })}
          />
        </Field>
      ) : null}
      {form.authKind !== 'none' ? (
        <Field
          id="action-secret"
          label={t('form.secret')}
          hint={t('form.secretHint')}
          className="sm:col-span-2"
        >
          <Input
            id="action-secret"
            type="password"
            autoComplete="new-password"
            value={form.secret}
            placeholder={form.hasSecret ? t('form.secretSaved') : t('form.secretPlaceholder')}
            onChange={(e) => set({ secret: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

/** Create (no `action`) or edit one API action, with the "Thử gọi" panel beside the stored version. */
export function ActionFormView({ botId, action }: { botId: string; action?: ActionDto }) {
  const { t } = useTranslation('action');
  const { t: common } = useTranslation();
  const navigate = useNavigate();
  const save = useSaveAction(botId);
  const [form, setForm] = useState<FormState>(() => (action ? formFromDto(action) : newForm()));
  const [submitted, setSubmitted] = useState(false);
  // Until the owner flips the switch themselves, it follows the method (writes ask by default).
  const confirmTouched = useRef(Boolean(action));

  const errors = submitted ? validateForm(form) : {};
  const errorText = useErrorText(errors);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function changeMethod(method: ActionMethod) {
    set(confirmTouched.current ? { method } : { method, requiresConfirm: confirmDefault(method) });
  }

  /** The form as the API would receive it, or null (with errors shown) while it is invalid. */
  function buildDraft(): ActionInput | null {
    setSubmitted(true);
    return Object.keys(validateForm(form)).length > 0 ? null : (toInput(form) as ActionInput);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validateForm(form)).length > 0) return;
    const body = toInput(form) as Parameters<typeof save.mutate>[0]['body'];
    save.mutate(action ? { id: action.id, body } : { body }, {
      onSuccess: () => {
        toast.success(t('saved'));
        void navigate({ to: '/app/bots/$botId/actions', params: { botId } });
      },
      onError: (error) => toast.error(errorMessage(common, error)),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">
        {action ? t('form.titleEdit') : t('form.titleNew')}
      </h1>

      <Field id="action-name" label={t('form.name')} error={errorText('name')}>
        <Input
          id="action-name"
          value={form.name}
          maxLength={80}
          placeholder={t('form.namePlaceholder')}
          aria-invalid={Boolean(errors['name'])}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <Field
        id="action-description"
        label={t('form.description')}
        hint={t('form.descriptionHint')}
        error={errorText('description')}
      >
        <Textarea
          id="action-description"
          rows={3}
          value={form.description}
          placeholder={t('form.descriptionPlaceholder')}
          aria-invalid={Boolean(errors['description'])}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label>{t('form.method')}</Label>
          <OptionSelect
            label={t('form.method')}
            value={form.method}
            options={METHODS.map((m) => ({ value: m, label: m }))}
            onChange={changeMethod}
          />
        </div>
        <Field
          id="action-url"
          label={t('form.url')}
          hint={t('form.urlHint')}
          error={errorText('url')}
        >
          <Input
            id="action-url"
            inputMode="url"
            value={form.url}
            placeholder="https://shop.vn/orders/{orderId}"
            aria-invalid={Boolean(errors['url'])}
            onChange={(e) => set({ url: e.target.value })}
          />
        </Field>
      </div>

      <AuthFields form={form} set={set} errorText={errorText} />
      <ParamsEditor rows={form.params} errors={errors} onChange={(params) => set({ params })} />
      <ResponsesEditor
        rows={form.responses}
        errors={errors}
        onChange={(responses) => set({ responses })}
      />

      <div className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <Switch
            id="action-confirm"
            checked={form.requiresConfirm}
            onCheckedChange={(requiresConfirm) => {
              confirmTouched.current = true;
              set({ requiresConfirm });
            }}
          />
          <div>
            <Label htmlFor="action-confirm">{t('form.requiresConfirm')}</Label>
            <p className="text-xs text-muted-foreground">{t('form.requiresConfirmHint')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="action-enabled"
            checked={form.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
          <Label htmlFor="action-enabled">{t('form.enabled')}</Label>
        </div>
      </div>

      <ActionTestPanel
        botId={botId}
        actionId={action?.id}
        params={form.params}
        buildDraft={buildDraft}
        draftKey={JSON.stringify(form)}
      />

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link to="/app/bots/$botId/actions" params={{ botId }}>
            {t('form.cancel')}
          </Link>
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('form.saving') : t('form.save')}
        </Button>
      </div>
    </form>
  );
}
