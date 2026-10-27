import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { type BotPagesPlan, planBotPages } from '../lib/integrations';
import { ConfirmDialog } from './confirm-dialog';
import { ProviderGlyph } from './platform-icon';

/**
 * Bot "Chỉnh sửa": choose which of the workspace's active pages this bot answers.
 * Taking a page from another bot asks for confirmation first.
 */
export function BotPagesDialog({
  open,
  botId,
  connections,
  botName,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  botId: string;
  connections: readonly ChannelConnectionDto[];
  botName: (id: string | null) => string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (plan: BotPagesPlan) => void;
}) {
  const { t } = useTranslation();
  const ti = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.${key}`, options ?? {});
  const active = connections.filter((c) => c.status === 'connected');
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(active.filter((c) => c.botId === botId).map((c) => c.id)),
  );
  const [confirming, setConfirming] = useState<BotPagesPlan | null>(null);
  const plan = planBotPages(active, botId, checked);
  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  function submit() {
    if (plan.moved.length) setConfirming(plan);
    else onSave(plan);
  }
  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ti('botPagesTitle')}</DialogTitle>
            <DialogDescription>{ti('botPagesBody')}</DialogDescription>
          </DialogHeader>
          {active.length ? (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {active.map((c) => {
                const other = c.botId && c.botId !== botId ? botName(c.botId) : null;
                return (
                  <li key={c.id}>
                    <Label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
                      <Checkbox
                        checked={checked.has(c.id)}
                        disabled={saving}
                        onCheckedChange={(value) => toggle(c.id, value === true)}
                      />
                      <ProviderGlyph provider={c.provider} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {ti('externalId', { id: c.externalId })}
                        </span>
                        {other ? (
                          <span className="mt-0.5 block truncate text-xs font-normal text-warning">
                            {ti('boundTo', { name: other })}
                          </span>
                        ) : null}
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
              {ti('noConnectedPages')}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={onClose}>
              {t('channelInbox.cancel')}
            </Button>
            <Button
              disabled={saving || (!plan.bind.length && !plan.unbind.length)}
              onClick={submit}
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              {ti('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirming)}
        title={ti('moveTitle')}
        body={ti('moveBody', { count: confirming?.moved.length ?? 0 })}
        confirm={ti('moveConfirm')}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) onSave(confirming);
          setConfirming(null);
        }}
      />
    </>
  );
}
