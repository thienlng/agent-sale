import { Cable, Hourglass, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlatformKey } from '../lib/integrations';

/** Centered empty state of the page list (no pages, no match, platform coming soon). */
export function IntegrationsEmpty({
  kind,
  platform,
  bot,
  children,
}: {
  kind: 'empty' | 'noMatch' | 'comingSoon';
  platform: PlatformKey;
  bot: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const ti = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.${key}`, options ?? {});
  const Icon = kind === 'comingSoon' ? Hourglass : kind === 'noMatch' ? SearchX : Cable;
  const site = platform === 'website' && kind === 'empty';
  const title = site
    ? ti('website.emptyTitle')
    : kind === 'comingSoon'
      ? ti('comingSoonTitle', { platform: ti(`platforms.${platform}`) })
      : kind === 'noMatch'
        ? ti('noMatch')
        : ti(bot ? 'botEmptyTitle' : 'emptyTitle');
  const body = site
    ? ti('website.emptyBody')
    : kind === 'comingSoon'
      ? ti('comingSoonBody')
      : kind === 'empty'
        ? ti(bot ? 'botEmptyBody' : 'emptyBody')
        : null;
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="size-7" aria-hidden />
      </span>
      <h3 className="font-semibold">{title}</h3>
      {body ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
