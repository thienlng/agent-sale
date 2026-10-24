import { ASSIGNABLE_ROLES, type AssignableRole } from '@agent-sales/contracts';
import { Check, Copy } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { errorMessage } from '@/lib/errors';
import { useRole } from '@/lib/permissions';

import { invitationLink, useTeamMutations } from '../api/team';

/** Invite by email and role; the link is shown once, to copy and send. */
export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { invite } = useTeamMutations();
  const isOwner = useRole() === 'owner';
  const roles = ASSIGNABLE_ROLES.filter((r) => isOwner || r !== 'admin');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('sales');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('sales');
      setLink(null);
      setCopied(false);
    }
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate(
      { email: email.trim(), role },
      {
        onSuccess: (r) => setLink(invitationLink(r.token)),
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  };
  const copy = () => {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast.success(t('team.copied'));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('team.invite')}</DialogTitle>
          <DialogDescription>{t('team.inviteHint')}</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            <Label htmlFor="invite-link">{t('team.link')}</Label>
            <div className="flex gap-2">
              <Input id="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {t('team.copy')}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t('team.linkOnce')}</p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('team.done')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">{t('team.email')}</Label>
              <Input
                id="invite-email"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t('team.role')}</legend>
              <RadioGroup value={role} onValueChange={(v) => setRole(v as AssignableRole)}>
                {roles.map((r) => (
                  <label
                    key={r}
                    htmlFor={`invite-role-${r}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary"
                  >
                    <RadioGroupItem id={`invite-role-${r}`} value={r} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{t(`team.roles.${r}`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`team.roleHints.${r}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={invite.isPending || !email.trim()}>
                {t('team.send')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
