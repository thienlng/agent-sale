import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';

import { CREDENTIAL_FIELDS, type CredentialField } from '../lib/errors';

export type CredentialValues = Record<CredentialField, string>;

/**
 * Store name, Client ID and secret with visible labels, helper text and errors under the field.
 * `attempt` changes after each failed submit, which moves focus to the first invalid field.
 */
export function CredentialsFields({
  values,
  errors,
  attempt,
  disabled,
  onChange,
}: {
  values: CredentialValues;
  errors: Partial<Record<CredentialField, string>>;
  attempt: number;
  disabled?: boolean;
  onChange: (field: CredentialField, value: string) => void;
}) {
  const { t } = useTranslation('integration');
  const id = useId();
  const [showSecret, setShowSecret] = useState(false);
  const refs = useRef<Partial<Record<CredentialField, HTMLInputElement | null>>>({});
  const fieldId = (f: CredentialField) => `${id}-${f}`;
  const errorId = (f: CredentialField) => `${id}-${f}-error`;
  const helpId = (f: CredentialField) => `${id}-${f}-help`;

  const latestErrors = useRef(errors);
  latestErrors.current = errors;
  useEffect(() => {
    if (attempt === 0) return;
    const first = CREDENTIAL_FIELDS.find((f) => latestErrors.current[f]);
    if (first) refs.current[first]?.focus();
  }, [attempt]);

  // One rejection covers both Client ID and secret: say it once, under the secret.
  const sharedAuth = Boolean(errors.clientId) && errors.clientId === errors.clientSecret;
  const describedBy = (f: CredentialField, help: boolean) => {
    const ids: string[] = [];
    if (help) ids.push(helpId(f));
    if (f === 'clientId' && sharedAuth) ids.push(errorId('clientSecret'));
    else if (errors[f]) ids.push(errorId(f));
    return ids.length ? ids.join(' ') : undefined;
  };
  const errorText = (f: CredentialField) =>
    errors[f] && !(f === 'clientId' && sharedAuth) ? (
      <p id={errorId(f)} className="text-sm text-destructive">
        {errors[f]}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId('retailer')}>{t('wizard.retailer')}</Label>
        <InputGroup className="h-11">
          <InputGroupInput
            id={fieldId('retailer')}
            ref={(el) => {
              refs.current.retailer = el;
            }}
            value={values.retailer}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.retailer) || undefined}
            aria-describedby={describedBy('retailer', true)}
            onChange={(e) => onChange('retailer', e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{t('wizard.retailerSuffix')}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <p id={helpId('retailer')} className="text-sm text-muted-foreground">
          {t('wizard.retailerHelp')}
        </p>
        {errorText('retailer')}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId('clientId')}>{t('wizard.clientId')}</Label>
        <Input
          id={fieldId('clientId')}
          ref={(el) => {
            refs.current.clientId = el;
          }}
          className="h-11"
          value={values.clientId}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.clientId) || undefined}
          aria-describedby={describedBy('clientId', false)}
          onChange={(e) => onChange('clientId', e.target.value)}
        />
        {errorText('clientId')}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId('clientSecret')}>{t('wizard.clientSecret')}</Label>
        <InputGroup className="h-11">
          <InputGroupInput
            id={fieldId('clientSecret')}
            ref={(el) => {
              refs.current.clientSecret = el;
            }}
            type={showSecret ? 'text' : 'password'}
            value={values.clientSecret}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.clientSecret) || undefined}
            aria-describedby={describedBy('clientSecret', true)}
            onChange={(e) => onChange('clientSecret', e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-sm"
              className="size-10"
              aria-label={showSecret ? t('wizard.hideSecret') : t('wizard.showSecret')}
              aria-pressed={showSecret}
              disabled={disabled}
              onClick={() => setShowSecret((s) => !s)}
            >
              {showSecret ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p id={helpId('clientSecret')} className="text-sm text-muted-foreground">
          {t('wizard.secretHelp')}
        </p>
        {errorText('clientSecret')}
      </div>
    </div>
  );
}
