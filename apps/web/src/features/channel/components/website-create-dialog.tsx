import type { BotDto, CreateWebsiteRequest } from '@agent-sales/contracts';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { parseDomains } from '../lib/website';

const NONE = 'none';

/** Name, domains (validated with the contract `Hostname`) and an optional bot. */
export function WebsiteCreateDialog({
  bots,
  defaultBotId,
  saving,
  onClose,
  onSubmit,
}: {
  bots: readonly BotDto[];
  /** Bot screen: the new site starts bound to this bot. */
  defaultBotId?: string | undefined;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: CreateWebsiteRequest) => void;
}) {
  const { t } = useTranslation();
  const tw = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.website.${key}`, options ?? {});
  const [name, setName] = useState('');
  const [domains, setDomains] = useState('');
  const [botId, setBotId] = useState(defaultBotId ?? NONE);
  const [submitted, setSubmitted] = useState(false);

  const parsed = parseDomains(domains);
  const nameError = !name.trim();
  const domainError = parsed.invalid.length
    ? tw('domainsInvalid', { list: parsed.invalid.join(', ') })
    : parsed.valid.length === 0 || parsed.valid.length > 10
      ? tw('domainsRequired')
      : null;

  function submit() {
    setSubmitted(true);
    if (nameError || domainError) return;
    onSubmit({
      name: name.trim(),
      domains: parsed.valid,
      ...(botId !== NONE ? { botId } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tw('createTitle')}</DialogTitle>
          <DialogDescription>{tw('createBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="website-name">{tw('name')}</Label>
            <Input
              id="website-name"
              value={name}
              maxLength={100}
              placeholder={tw('namePlaceholder')}
              aria-invalid={submitted && nameError}
              onChange={(event) => setName(event.target.value)}
            />
            {submitted && nameError ? (
              <p role="alert" className="text-xs text-destructive">
                {tw('nameRequired')}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="website-domains">{tw('domains')}</Label>
            <Textarea
              id="website-domains"
              rows={2}
              value={domains}
              placeholder={tw('domainsPlaceholder')}
              aria-invalid={submitted && domainError !== null}
              onChange={(event) => setDomains(event.target.value)}
            />
            {submitted && domainError ? (
              <p role="alert" className="text-xs text-destructive">
                {domainError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{tw('domainsHint')}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="website-bot">{tw('bot')}</Label>
            <Select disabled={saving} value={botId} onValueChange={setBotId}>
              <SelectTrigger id="website-bot" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tw('noBotOption')}</SelectItem>
                {bots.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>
                    {bot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('channelInbox.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {tw('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
