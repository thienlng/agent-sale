import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const NAV: ReadonlyArray<{ to: string; key: string }> = [
  { to: '/app/bots', key: 'nav.bots' },
  { to: '/app/inbox', key: 'nav.inbox' },
  { to: '/app/channels', key: 'nav.channels' },
  { to: '/app/contacts', key: 'nav.contacts' },
  { to: '/app/orders', key: 'nav.orders' },
  { to: '/app/analytics', key: 'nav.analytics' },
  { to: '/app/settings', key: 'nav.settings' },
];

/** Shared shell: sidebar + content. Routes decide what goes inside. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-border p-4" aria-label="Main navigation">
        <div className="mb-6 text-lg font-semibold">{t('app.name')}</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-2 text-sm hover:bg-accent"
              activeProps={{ className: 'bg-accent font-medium' }}
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
