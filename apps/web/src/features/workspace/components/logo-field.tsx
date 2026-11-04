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

import { LogoCropper } from './logo-cropper';

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

/** Logo preview with upload and remove; any image is cropped to a square here, the server re-checks the bytes. */
export function LogoField({ logoVersion }: { logoVersion: string | null }) {
  const { t } = useTranslation();
  const canEdit = useCan('settings.manage');
  const { uploadLogo, removeLogo } = useProfileMutations();
  const logo = useLogoUrl(logoVersion);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [cropping, setCropping] = useState<File | null>(null);

  /** Any image the browser can open goes to the cropper; it exports a valid square logo. */
  const pick = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProblem(t('wsettings.logo.errors.type'));
      return;
    }
    setCropping(file);
  };

  const upload = (logo: File) => {
    setCropping(null);
    uploadLogo.mutate(logo, {
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
                accept="image/*"
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
      <LogoCropper
        file={cropping}
        onCancel={() => setCropping(null)}
        onDone={upload}
        onUnreadable={() => {
          setCropping(null);
          setProblem(t('wsettings.logo.errors.unreadable'));
        }}
      />
    </section>
  );
}
