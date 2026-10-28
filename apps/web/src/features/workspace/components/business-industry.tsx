import { Industry } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentWorkspace } from '../api/use-current-workspace';

/** Industry belongs to the selected business and is not an editable billing setting. */
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
    <section className="space-y-2 rounded-lg border p-4" aria-label={t('wsettings.industry.title')}>
      <h3 className="font-medium">{workspace.data.name}</h3>
      <Label htmlFor="business-industry">{t('auth.industry')}</Label>
      <Input
        id="business-industry"
        readOnly
        value={industry.success ? t(`industries.${industry.data}`) : workspace.data.industry}
      />
      <p className="text-sm text-muted-foreground">{t('wsettings.industry.policy')}</p>
      {!industry.success ? (
        <p className="text-sm text-warning">
          {t('bots.businessUnsupported', { industry: workspace.data.industry })}
        </p>
      ) : null}
    </section>
  );
}
