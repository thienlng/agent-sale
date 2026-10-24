import { ASSIGNABLE_ROLES, type AssignableRole, type MemberDto } from '@agent-sales/contracts';
import { UserPlus, UserX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useCan, useRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { useInvitations, useMembers, useTeamMutations } from '../api/team';
import { InviteDialog } from './invite-dialog';

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
  const { changeRole, remove, revoke } = useTeamMutations();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const fail = (err: unknown) => toast.error(errorMessage(t, err));
  const roles = ASSIGNABLE_ROLES.filter((r) => actorRole === 'owner' || r !== 'admin');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('team.title')}</h1>
        {manage ? (
          <Button size="lg" onClick={() => setInviting(true)}>
            <UserPlus />
            {t('team.invite')}
          </Button>
        ) : null}
      </header>

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
                (members.data ?? []).map((m) => {
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
                    <TableHead className="w-24" />
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
      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('team.remove')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('team.removeConfirm', { name: removing?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('team.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removing &&
                remove.mutate(removing.userId, {
                  onSuccess: () => toast.success(t('team.removed')),
                  onError: fail,
                })
              }
            >
              {t('team.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
