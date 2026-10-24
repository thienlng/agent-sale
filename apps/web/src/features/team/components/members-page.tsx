import { ASSIGNABLE_ROLES, type AssignableRole, type MemberDto } from '@agent-sales/contracts';
import { UserPlus, UserX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useCan, useRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { invitationLink, useInvitations, useMembers, useTeamMutations } from '../api/team';
import { InviteDialog } from './invite-dialog';
import { LinkDialog } from './link-dialog';
import { QuotaDialog } from './quota-dialog';
import { RemoveMemberDialog } from './remove-member-dialog';
import { SeatMeter } from './seat-meter';

/** The plan has no free seat (HTTP 402 QUOTA_EXCEEDED). */
const isQuota = (err: unknown) => err instanceof ApiClientError && err.code === 'QUOTA_EXCEEDED';

/** Admins manage sales, CSKH and analysts; only the owner manages admins (same as the server). */
function canManage(actorRole: string | undefined, m: MemberDto): boolean {
  if (m.role === 'owner' || m.isYou || m.status !== 'active') return false;
  return actorRole === 'owner' || m.role !== 'admin';
}

/** Members & access (docs/02 SET-01): members, roles, invitation links. */
export function MembersPage() {
  const { t } = useTranslation();
  const manage = useCan('members.manage');
  const actorRole = useRole();
  const members = useMembers();
  const invitations = useInvitations(manage);
  const { changeRole, resend, revoke } = useTeamMutations();
  const [inviting, setInviting] = useState(false);
  const [resentLink, setResentLink] = useState<string | null>(null);
  const [quota, setQuota] = useState(false);
  const seats = members.data?.seats;
  const full =
    seats?.limit !== undefined && seats.limit !== null && seats.used + seats.pending >= seats.limit;
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const fail = (err: unknown) => toast.error(errorMessage(t, err));
  const roles = ASSIGNABLE_ROLES.filter((r) => actorRole === 'owner' || r !== 'admin');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('team.title')}</h1>
        {manage ? (
          <Button size="lg" onClick={() => (full ? setQuota(true) : setInviting(true))}>
            <UserPlus />
            {t('team.invite')}
          </Button>
        ) : null}
      </header>

      {seats ? <SeatMeter seats={seats} /> : null}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('team.members')}</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('team.col.name')}</TableHead>
                <TableHead>{t('team.col.email')}</TableHead>
                <TableHead>{t('team.col.role')}</TableHead>
                <TableHead>{t('team.col.status')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('team.col.joined')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.isPending ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ) : (
                (members.data?.data ?? []).map((m) => {
                  const editable = manage && canManage(actorRole, m);
                  return (
                    <TableRow key={m.userId} className={cn(m.status === 'removed' && 'opacity-60')}>
                      <TableCell className="font-medium">
                        {m.name}
                        {m.isYou ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({t('team.you')})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-56 truncate">{m.email}</TableCell>
                      <TableCell>
                        {editable ? (
                          <Select
                            value={m.role}
                            onValueChange={(role) =>
                              changeRole.mutate(
                                { userId: m.userId, role: role as AssignableRole },
                                {
                                  onSuccess: () => toast.success(t('team.roleChanged')),
                                  onError: fail,
                                },
                              )
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-36"
                              aria-label={`${t('team.col.role')}: ${m.name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roles.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {t(`team.roles.${r}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          t(`team.roles.${m.role}`, { defaultValue: m.role })
                        )}
                      </TableCell>
                      <TableCell>{t(`team.memberStatus.${m.status}`)}</TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                        {formatDateTime(m.joinedAt)}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${t('team.remove')}: ${m.name}`}
                            onClick={() => setRemoving(m)}
                          >
                            <UserX />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {manage ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('team.invitations')}</h2>
          {invitations.data?.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('team.col.email')}</TableHead>
                    <TableHead>{t('team.col.role')}</TableHead>
                    <TableHead>{t('team.col.status')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('team.col.expires')}</TableHead>
                    <TableHead className="hidden lg:table-cell">
                      {t('team.col.invitedBy')}
                    </TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.data.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-56 truncate">{i.email}</TableCell>
                      <TableCell>{t(`team.roles.${i.role}`)}</TableCell>
                      <TableCell>{t(`team.inviteStatus.${i.status}`)}</TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                        {formatDateTime(i.expiresAt)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {i.invitedByName ?? '—'}
                      </TableCell>
                      <TableCell>
                        {i.status !== 'accepted' ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={resend.isPending}
                              onClick={() =>
                                resend.mutate(i.id, {
                                  onSuccess: (r) => {
                                    setResentLink(invitationLink(r.token));
                                    toast.success(t('team.resent'));
                                  },
                                  onError: (err) => (isQuota(err) ? setQuota(true) : fail(err)),
                                })
                              }
                            >
                              {t('team.resend')}
                            </Button>
                            {i.status === 'pending' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  revoke.mutate(i.id, {
                                    onSuccess: () => toast.success(t('team.revoked')),
                                    onError: fail,
                                  })
                                }
                              >
                                {t('team.revoke')}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('team.noInvitations')}</p>
          )}
        </div>
      ) : null}

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <QuotaDialog open={quota} seats={seats} onClose={() => setQuota(false)} />
      <RemoveMemberDialog
        member={removing}
        members={members.data?.data ?? []}
        onClose={() => setRemoving(null)}
      />
      <LinkDialog
        link={resentLink}
        title={t('team.resendTitle')}
        onClose={() => setResentLink(null)}
      />
    </section>
  );
}
