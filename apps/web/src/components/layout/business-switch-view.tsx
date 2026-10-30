import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { Fragment, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { groupByAccount } from '@/lib/business-groups';
import type { Session } from '@/lib/session';

/**
 * The account panel's "Switch business" level (T-079): businesses grouped by the account that
 * owns them, the current one checked, then "Create business". It uses the same switch as the
 * sidebar selector, so both clear the previous business's cached data the same way.
 */
export function BusinessSwitchView({
  session,
  firstItem,
  rowIcon,
  onBack,
  onChosen,
}: {
  session: Session;
  firstItem: Ref<HTMLDivElement>;
  rowIcon: (icon: ReactNode) => ReactNode;
  onBack: () => void;
  onChosen: () => void;
}) {
  const { t } = useTranslation();
  const { busy, choose } = useBusinessSwitch();
  return (
    <>
      <DropdownMenuItem
        ref={firstItem}
        className="gap-3 py-1.5 text-base font-semibold"
        onSelect={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        {rowIcon(<ArrowLeft />)}
        <span className="sr-only">{t('account.back')}: </span>
        {t('business.switch')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <div className="max-h-80 overflow-y-auto">
        {groupByAccount(session.memberships).map((group, i) => (
          <Fragment key={group.accountId ?? 'none'}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {group.accountName ?? t('business.noAccount')}
              </DropdownMenuLabel>
              {group.businesses.map((m) => (
                <DropdownMenuItem
                  key={m.workspaceId}
                  disabled={busy}
                  aria-current={m.workspaceId === session.workspaceId ? 'true' : undefined}
                  onSelect={() => {
                    void choose(m.workspaceId).then((done) => {
                      if (done) onChosen();
                    });
                  }}
                >
                  <span className="min-w-0 flex-1 break-words">{m.workspaceName}</span>
                  {m.workspaceId === session.workspaceId ? <Check aria-hidden /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild className="gap-3 py-1.5">
        <Link to="/app/businesses/new">
          {rowIcon(<Plus />)}
          {t('business.createAction')}
        </Link>
      </DropdownMenuItem>
    </>
  );
}
