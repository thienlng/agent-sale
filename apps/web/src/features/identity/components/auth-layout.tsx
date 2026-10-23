import { BadgeCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@/components/logo';

/**
 * Two halves: the form, and the one thing Razpi does — a customer typing the
 * way real customers type, and the bot answering from the shop's own data.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-10">{children}</div>
        </div>
      </div>
      <aside
        aria-hidden
        className="relative hidden overflow-hidden bg-primary lg:flex lg:items-center lg:justify-center"
      >
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-20 size-[28rem] rounded-full bg-primary-strong/60" />
        <figure className="relative w-full max-w-md px-10">
          <div className="rounded-2xl bg-background p-5 shadow-2xl shadow-primary-strong/40">
            <div className="flex items-center gap-2 border-b pb-3 text-sm font-medium">
              <span className="size-2 rounded-full bg-success" />
              {t('app.name')}
            </div>
            <div className="flex flex-col gap-3 pt-4 text-base">
              <p className="max-w-[85%] self-end rounded-[1.1rem] rounded-br-md bg-bubble-customer px-3.5 py-2 animate-[bubble-in_400ms_ease-out_200ms_both]">
                {t('auth.demo.customer')}
              </p>
              <div className="flex max-w-[88%] flex-col gap-1.5 animate-[bubble-in_400ms_ease-out_900ms_both]">
                <p className="rounded-[1.1rem] rounded-bl-md bg-bubble-bot px-3.5 py-2 text-primary-foreground">
                  {t('auth.demo.bot')}
                </p>
                <span className="inline-flex items-center gap-1 self-start rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                  <BadgeCheck className="size-3.5" />
                  {t('auth.demo.source')}
                </span>
              </div>
            </div>
          </div>
          <figcaption className="mt-8 text-lg leading-relaxed font-medium text-primary-foreground">
            {t('auth.demo.caption')}
          </figcaption>
        </figure>
      </aside>
    </div>
  );
}
