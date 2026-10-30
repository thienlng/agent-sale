import { Link } from '@tanstack/react-router';

export interface SettingsTab {
  to: string;
  label: string;
}

/**
 * The tab strip of a settings area. Horizontal scroll stays on narrow screens, but the strip
 * never scrolls vertically (no native up/down arrows): the baseline is an inset shadow on the
 * nav instead of a negative-margin child border, which used to overflow the scroll box by 1px.
 */
export function SettingsTabs({ label, tabs }: { label: string; tabs: readonly SettingsTab[] }) {
  return (
    <nav
      aria-label={label}
      className="flex gap-5 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_0_var(--border)]"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="shrink-0 border-b-2 border-transparent pb-2.5 text-base text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
