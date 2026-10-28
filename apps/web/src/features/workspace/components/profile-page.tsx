import { BUSINESS_ICONS, type WorkspaceProfileDto } from '@agent-sales/contracts';
import { useBlocker } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { businessIcon } from '@/lib/business-icons';
import { useCan } from '@/lib/permissions';

import { useProfile, useProfileMutations } from '../api/profile';
import { rebaseDraft } from '../utils/profile-draft';
import { BusinessIndustry } from './business-industry';
import { LogoField } from './logo-field';

type Draft = Pick<
  WorkspaceProfileDto,
  'name' | 'companyName' | 'businessServices' | 'productDescription' | 'icon'
>;
const draftOf = (p: WorkspaceProfileDto): Draft => ({
  name: p.name,
  companyName: p.companyName,
  businessServices: p.businessServices,
  productDescription: p.productDescription,
  icon: p.icon,
});

function ProfileForm({ profile }: { profile: WorkspaceProfileDto }) {
  const { t } = useTranslation();
  const canEdit = useCan('settings.manage');
  const { update } = useProfileMutations();
  const base = draftOf(profile);
  const [draft, setDraft] = useState<Draft>(base);
  const dirty = (Object.keys(base) as Array<keyof Draft>).some((k) => draft[k] !== base[k]);

  // Leaving with unsaved edits asks first: in-app navigation and closing the tab.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  const shown = useRef(base);
  useEffect(() => {
    const old = shown.current;
    shown.current = draftOf(profile);
    setDraft((d) => rebaseDraft(d, old, shown.current));
  }, [profile]);

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !canEdit) return;
    update.mutate(
      { ...draft, expectedVersion: profile.version },
      {
        onSuccess: () => toast.success(t('wsettings.profile.saved')),
        onError: (err) =>
          toast.error(
            err instanceof ApiClientError && err.code === 'CONFLICT'
              ? t('wsettings.profile.stale')
              : errorMessage(t, err),
          ),
      },
    );
  };

  const field = (
    key: Exclude<keyof Draft, 'icon'>,
    label: string,
    max: number,
    multiline?: boolean,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`pf-${key}`}>{label}</Label>
      {multiline ? (
        <Textarea
          id={`pf-${key}`}
          rows={key === 'productDescription' ? 6 : 3}
          maxLength={max}
          disabled={!canEdit}
          value={draft[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      ) : (
        <Input
          id={`pf-${key}`}
          maxLength={max}
          required={key === 'name'}
          disabled={!canEdit}
          value={draft[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!canEdit ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t('wsettings.profile.readOnly')}
        </p>
      ) : null}
      {field('name', t('wsettings.profile.name'), 120)}
      <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
        <legend className="text-sm font-medium">{t('wsettings.icon.title')}</legend>
        <p className="text-sm text-muted-foreground">
          {profile.hasLogo ? t('wsettings.icon.hintLogo') : t('wsettings.icon.hint')}
        </p>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t('wsettings.icon.title')}
        >
          {BUSINESS_ICONS.map((key) => {
            const Icon = businessIcon(key);
            const name = t(`wsettings.icon.names.${key}`);
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={draft.icon === key}
                aria-label={name}
                title={name}
                onClick={() => set({ icon: key })}
                className="grid size-10 place-items-center rounded-lg border text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 aria-checked:border-primary aria-checked:bg-primary-soft aria-checked:text-accent-foreground"
              >
                <Icon aria-hidden className="size-5" />
              </button>
            );
          })}
        </div>
      </fieldset>
      {field('companyName', t('wsettings.profile.companyName'), 200)}
      {field('businessServices', t('wsettings.profile.businessServices'), 1000, true)}
      {field('productDescription', t('wsettings.profile.productDescription'), 5000, true)}
      {canEdit ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {dirty ? (
            <span className="mr-auto text-sm text-warning" role="status">
              {t('wsettings.profile.dirty')}
            </span>
          ) : null}
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setDraft(base)}>
            {t('wsettings.profile.reset')}
          </Button>
          <Button type="submit" disabled={!dirty || update.isPending || !draft.name.trim()}>
            {t('wsettings.profile.save')}
          </Button>
        </div>
      ) : null}
      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('wsettings.profile.dirty')}</DialogTitle>
            <DialogDescription>{t('wsettings.profile.leave')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {t('wsettings.profile.stay')}
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('wsettings.profile.leaveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** Business profile and logo of the workspace (ADM-02). */
export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useProfile();
  if (!profile.data) return <Skeleton className="h-96 max-w-2xl rounded-xl" />;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="font-semibold">{t('wsettings.profile.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('wsettings.profile.hint')}</p>
      </div>
      <BusinessIndustry />
      <LogoField logoVersion={profile.data.logoVersion} />
      <ProfileForm profile={profile.data} />
    </div>
  );
}
