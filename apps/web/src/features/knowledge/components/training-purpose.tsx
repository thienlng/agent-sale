import { Link } from '@tanstack/react-router';
import { BookOpen, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Clarifies where knowledge belongs without moving or rewriting saved training data. */
export function TrainingPurpose({
  botId,
  kind,
}: {
  botId: string;
  kind: 'facts' | 'instructions';
}) {
  const { t } = useTranslation('training');
  const Icon = kind === 'facts' ? Info : BookOpen;
  return (
    <aside
      className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4"
      aria-label={t(`purpose.${kind}.title`)}
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 space-y-1 text-sm">
        <h2 className="font-semibold">{t(`purpose.${kind}.title`)}</h2>
        <p>{t(`purpose.${kind}.body`)}</p>
        <p className="text-muted-foreground">{t(`purpose.${kind}.example`)}</p>
        <Link
          to={kind === 'facts' ? '/app/bots/$botId/instructions' : '/app/bots/$botId/knowledge'}
          params={{ botId }}
          className="inline-flex pt-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          {t(`purpose.${kind}.link`)}
        </Link>
      </div>
    </aside>
  );
}
