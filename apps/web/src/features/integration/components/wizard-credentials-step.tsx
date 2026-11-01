import { ChevronRight, CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

import type { CredentialField } from '../lib/errors';
import { CredentialsFields, type CredentialValues } from './credentials-fields';

export const KIOTVIET_API_GUIDE = 'https://www.kiotviet.vn/huong-dan-su-dung-public-api-retail/';

/** Step 1: store name, Client ID and secret, checked against KiotViet before moving on. */
export function WizardCredentialsStep({
  values,
  errors,
  banner,
  attempt,
  testing,
  onChange,
  onSubmit,
}: {
  values: CredentialValues;
  errors: Partial<Record<CredentialField, string>>;
  banner: string | null;
  attempt: number;
  testing: boolean;
  onChange: (field: CredentialField, value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation('integration');
  const steps = t('wizard.whereSteps', { returnObjects: true }) as unknown;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!testing) onSubmit();
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      {banner ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      ) : null}
      <CredentialsFields
        values={values}
        errors={errors}
        attempt={attempt}
        disabled={testing}
        onChange={onChange}
      />
      <Collapsible className="group/where rounded-lg border">
        <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 transition-transform group-data-[state=open]/where:rotate-90"
          />
          {t('wizard.where')}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 px-3 pb-3">
          <ol className="list-decimal space-y-1.5 pl-9 text-sm text-muted-foreground">
            {(Array.isArray(steps) ? steps.map(String) : []).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <a
            href={KIOTVIET_API_GUIDE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('wizard.guideLink')}
            <ExternalLink aria-hidden className="size-4" />
          </a>
        </CollapsibleContent>
      </Collapsible>
      <div className="flex justify-end">
        <Button type="submit" size="lg" className="h-11 w-full sm:w-auto" disabled={testing}>
          {testing ? <LoaderCircle aria-hidden className="motion-safe:animate-spin" /> : null}
          {t('wizard.test')}
        </Button>
      </div>
    </form>
  );
}
