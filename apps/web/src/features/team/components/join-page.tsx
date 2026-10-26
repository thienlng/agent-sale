import { Link, useNavigate } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { reloadSession, useSession } from '@/lib/session';

import { useAcceptInvitation, useInvitationPreview } from '../api/team';

function Signed({ token }: { token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();
  if (preview.error) {
    return (
      <p className="text-sm text-muted-foreground">
        {preview.error instanceof ApiClientError && preview.error.status === 404
          ? t('team.join.notFound')
          : errorMessage(t, preview.error)}
      </p>
    );
  }
  const p = preview.data;
  if (!p) return <Skeleton className="h-24" />;
  const role = t(`team.roles.${p.role}`);
  return (
    <div className="flex flex-col gap-4">
      <p>{t('team.join.intro', { workspace: p.workspaceName, role })}</p>
      {p.status !== 'pending' && p.status !== 'accepted' ? (
        <p className="text-sm text-destructive">
          {t('team.join.unusable', { status: t(`team.inviteStatus.${p.status}`) })}
        </p>
      ) : !p.emailMatches ? (
        <p className="text-sm text-destructive">{t('team.join.wrongEmail', { email: p.email })}</p>
      ) : (
        <Button
          size="lg"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(token, {
              onSuccess: async (r) => {
                await reloadSession(r.workspaceId);
                toast.success(t('team.join.accepted', { workspace: r.workspaceName }));
                void navigate({ to: '/app/contacts' });
              },
              onError: (err) => toast.error(errorMessage(t, err)),
            })
          }
        >
          {t('team.join.accept')}
        </Button>
      )}
    </div>
  );
}

/** /join?token=…: preview and accept an invitation link (SET-01). */
export function JoinPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const back = `/join?token=${encodeURIComponent(token)}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <MailCheck className="size-6 text-primary" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">{t('team.join.title')}</h1>
      </div>
      {session ? (
        <Signed token={token} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('team.join.loginFirst')}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/login" search={{ redirect: back }}>
                {t('team.join.login')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/signup" search={{ redirect: back }}>
                {t('team.join.signup')}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
