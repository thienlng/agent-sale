import { CreateSaasRequest, type SaasRequestDto, SaasRequestKind } from '@agent-sales/contracts';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/permissions';

import { useCreateSaasRequest } from '../api/saas';

const TEXT_FIELDS = ['company', 'teamSize', 'preferredTime', 'planInterest'] as const;

/** Staff record a demo, trial or consultation request (the bot records its own, ADR-014). */
export function SaasRequestForm({
  onSaved,
  initialName = '',
  initialPhone = '',
  contactId = null,
}: {
  onSaved: (row: SaasRequestDto) => void;
  initialName?: string;
  initialPhone?: string;
  contactId?: string | null;
}) {
  const { t } = useTranslation(),
    create = useCreateSaasRequest(),
    canCreate = useCan('contacts.edit');
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<SaasRequestKind>('demo');
  const [values, setValues] = useState<Record<string, string>>({
    name: initialName,
    phone: initialPhone,
  });
  const [invalid, setInvalid] = useState(false);
  const value = (key: string) => values[key] ?? '';
  const set = (key: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = CreateSaasRequest.safeParse({
      ...values,
      phone: value('phone').trim() || null,
      email: value('email').trim() || null,
      kind,
      contactId,
      clientRequestId,
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (row) => {
        toast.success(t('saas.requestSaved'));
        onSaved(row);
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    });
  }

  if (!canCreate) return <p role="status">{t('saas.permission')}</p>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="saas-kind">{t('saas.field.kind')}</Label>
        <Select value={kind} onValueChange={(v) => setKind(SaasRequestKind.parse(v))}>
          <SelectTrigger id="saas-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SaasRequestKind.options.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`saas.kind.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="saas-name">{t('saas.field.name')}</Label>
        <Input
          id="saas-name"
          value={value('name')}
          onChange={set('name')}
          maxLength={120}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="saas-phone">{t('saas.field.phone')}</Label>
          <Input
            id="saas-phone"
            type="tel"
            value={value('phone')}
            onChange={set('phone')}
            maxLength={40}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="saas-email">{t('saas.field.email')}</Label>
          <Input
            id="saas-email"
            type="email"
            value={value('email')}
            onChange={set('email')}
            maxLength={200}
          />
        </div>
        {TEXT_FIELDS.map((key) => (
          <div className="space-y-2" key={key}>
            <Label htmlFor={`saas-${key}`}>{t(`saas.field.${key}`)}</Label>
            <Input id={`saas-${key}`} value={value(key)} onChange={set(key)} maxLength={200} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="saas-need">{t('saas.field.need')}</Label>
        <Textarea id="saas-need" value={value('need')} onChange={set('need')} maxLength={2000} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="saas-note">{t('saas.field.note')}</Label>
        <Textarea id="saas-note" value={value('note')} onChange={set('note')} maxLength={2000} />
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('saas.requestInvalid')}
        </p>
      )}
      <Button type="submit" disabled={create.isPending}>
        {t('saas.saveRequest')}
      </Button>
    </form>
  );
}
