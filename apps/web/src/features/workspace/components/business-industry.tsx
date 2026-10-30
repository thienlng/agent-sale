import { Industry } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { useCurrentWorkspace } from '../api/use-current-workspace';

/**
 * The business template (industry) as a labelled read-only summary. It is chosen when the
 * business is created and does not change afterwards, so it is text, not a form control.
 */
export function BusinessIndustry() {
  const { t } = useTranslation();
  const workspace = useCurrentWorkspace();
  if (workspace.isPending) return <p role="status">{t('bots.businessLoading')}</p>;
  if (workspace.isError)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('bots.businessError')}</p>
        <Button type="button" variant="outline" onClick={() => void workspace.refetch()}>
          {t('bots.businessRetry')}
        </Button>
      </div>
    );
  const industry = Industry.safeParse(workspace.data.industry);
  return (
    <div className="flex flex-col gap-1">
      <dl className="flex flex-wrap items-baseline gap-x-2">
        <dt className="text-sm font-medium">{t('wsettings.profile.template')}</dt>
        <dd>{industry.success ? t(`industries.${industry.data}`) : workspace.data.industry}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">{t('wsettings.profile.templateHint')}</p>
      {!industry.success ? (
        <p className="text-sm text-warning">
          {t('bots.businessUnsupported', { industry: workspace.data.industry })}
        </p>
      ) : null}
    </div>
  );
}
