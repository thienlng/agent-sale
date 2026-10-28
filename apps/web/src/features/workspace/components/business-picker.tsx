import { Building2, ChevronRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { groupByAccount } from '@/lib/business-groups';
import type { Session } from '@/lib/session';

/** Shown after login when the user works in several businesses and has not chosen one. */
export function BusinessPicker({
  session,
  lost,
  onChoose,
  onCreate,
}: {
  session: Session;
  /** The previous business was lost (membership removed): say so instead of failing silently. */
  lost: boolean;
  onChoose: (workspaceId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('business.pickTitle')}</h1>
        <p className="mt-1.5 text-muted-foreground">{t('business.pickSubtitle')}</p>
      </div>
      {lost ? (
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning">
          {t('business.lost')}
        </p>
      ) : null}
      {groupByAccount(session.memberships).map((group) => (
        <section key={group.accountId ?? 'none'} aria-label={group.accountName ?? undefined}>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            {group.accountName ?? t('business.noAccount')}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.businesses.map((m) => (
              <li key={m.workspaceId}>
                <button
                  type="button"
                  onClick={() => onChoose(m.workspaceId)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Building2 aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{m.workspaceName}</span>
                    {m.industry ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {t(`industries.${m.industry}`, { defaultValue: m.industry })}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button type="button" variant="outline" className="h-10" onClick={onCreate}>
        <Plus aria-hidden />
        {t('business.create')}
      </Button>
    </div>
  );
}
