import { LOGO_RULES } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/permissions';

import { useLogoUrl, useProfileMutations } from '../api/profile';

/** The message for a rejected logo: the server names the rule, with the numbers it needs. */
function logoError(t: TFunction, err: unknown): string {
  if (err instanceof ApiClientError && err.code === 'VALIDATION_FAILED') {
    const d = err.details as { reason?: string; width?: number; height?: number } | undefined;
    if (d?.reason) {
      return t(`wsettings.logo.errors.${d.reason}`, { width: d.width, height: d.height });
    }
  }
  return errorMessage(t, err);
}

/** Logo preview with upload and remove; the file is checked here first, and again by the server. */
export function LogoField({ logoVersion }: { logoVersion: string | null }) {
  const { t } = useTranslation();
  const canEdit = useCan('settings.manage');
  const { uploadLogo, removeLogo } = useProfileMutations();
  const logo = useLogoUrl(logoVersion);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    // Early, friendly checks; the server decides from the bytes.
    if (!(LOGO_RULES.mimes as readonly string[]).includes(file.type)) {
      setProblem(t('wsettings.logo.errors.type'));
      return;
    }
    if (file.size > LOGO_RULES.maxBytes) {
      setProblem(t('wsettings.logo.errors.too_large'));
      return;
    }
    uploadLogo.mutate(file, {
      onSuccess: () => toast.success(t('wsettings.logo.uploaded')),
      onError: (err) => setProblem(logoError(t, err)),
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{t('wsettings.logo.title')}</h2>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted/40">
          {logo.data ? (
            <img src={logo.data} alt={t('wsettings.logo.alt')} className="size-full object-cover" />
          ) : (
            <span className="px-2 text-center text-xs text-muted-foreground">
              {t('wsettings.logo.none')}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="max-w-md text-sm text-muted-foreground">{t('wsettings.logo.rules')}</p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                aria-label={t('wsettings.logo.upload')}
                onChange={(e) => {
                  pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadLogo.isPending}
                onClick={() => input.current?.click()}
              >
                <ImagePlus />
                {uploadLogo.isPending
                  ? t('wsettings.logo.uploading')
                  : t(logoVersion ? 'wsettings.logo.change' : 'wsettings.logo.upload')}
              </Button>
              {logoVersion ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removeLogo.isPending}
                  onClick={() =>
                    removeLogo.mutate(undefined, {
                      onSuccess: () => toast.success(t('wsettings.logo.removed')),
                      onError: (err) => toast.error(errorMessage(t, err)),
                    })
                  }
                >
                  <Trash2 />
                  {t('wsettings.logo.remove')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
