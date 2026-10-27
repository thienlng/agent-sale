import type { ChannelConnectionDto, UpdateWebsiteRequest } from '@agent-sales/contracts';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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
import {
  diffSettings,
  settingsOf,
  type SettingsForm,
  toForm,
  validateSettingsForm,
} from '../lib/website';
import { WebsitePreview } from './website-preview';

/** Settings form with a live static preview; saves only the fields that changed. */
export function WebsiteSettingsPanel({
  connection,
  saving,
  onClose,
  onSave,
}: {
  connection: ChannelConnectionDto;
  saving: boolean;
  onClose: () => void;
  onSave: (body: UpdateWebsiteRequest) => void;
}) {
  const { t } = useTranslation();
  const tw = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.website.${key}`, options ?? {});
  const current = settingsOf(connection.settings);
  const [name, setName] = useState(connection.name);
  const [form, setForm] = useState<SettingsForm>(() => toForm(current));
  const [submitted, setSubmitted] = useState(false);

  const validation = validateSettingsForm(form);
  const errors = validation.ok ? {} : validation.errors;
  const nameError = !name.trim();
  // The preview follows the form while it is valid; otherwise it keeps the last saved look.
  const previewSettings = validation.ok ? validation.settings : current;
  const set =
    <K extends keyof SettingsForm>(key: K) =>
    (value: SettingsForm[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  function save() {
    setSubmitted(true);
    if (!validation.ok || nameError) return;
    const body: UpdateWebsiteRequest = diffSettings(current, validation.settings);
    if (name.trim() !== connection.name) body.name = name.trim();
    if (Object.keys(body).length === 0) onClose();
    else onSave(body);
  }

  const field = (
    key: keyof SettingsForm,
    label: string,
    control: (props: { id: string; invalid: boolean }) => React.ReactNode,
  ) => {
    const invalid = submitted && errors[key] === true;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`website-${key}`}>{label}</Label>
        {control({ id: `website-${key}`, invalid })}
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            {tw('fieldInvalid')}
          </p>
        ) : null}
      </div>
    );
  };
  const text = (key: Exclude<keyof SettingsForm, 'position'>, label: string, max?: number) =>
    field(key, label, ({ id, invalid }) => (
      <Input
        id={id}
        value={form[key]}
        maxLength={max}
        aria-invalid={invalid}
        onChange={(event) => set(key)(event.target.value)}
      />
    ));

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{tw('settingsTitle', { name: connection.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
          <form
            className="space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="website-settings-name">{tw('fields.name')}</Label>
              <Input
                id="website-settings-name"
                value={name}
                maxLength={100}
                aria-invalid={submitted && nameError}
                onChange={(event) => setName(event.target.value)}
              />
              {submitted && nameError ? (
                <p role="alert" className="text-xs text-destructive">
                  {tw('nameRequired')}
                </p>
              ) : null}
            </div>
            {field('domains', tw('fields.domains'), ({ id, invalid }) => (
              <Textarea
                id={id}
                rows={2}
                value={form.domains}
                aria-invalid={invalid}
                onChange={(event) => set('domains')(event.target.value)}
              />
            ))}
            {text('color', tw('fields.color'), 7)}
            {field('position', tw('fields.position'), ({ id }) => (
              <Select
                value={form.position}
                onValueChange={(value) => set('position')(value === 'left' ? 'left' : 'right')}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">{tw('fields.positionRight')}</SelectItem>
                  <SelectItem value="left">{tw('fields.positionLeft')}</SelectItem>
                </SelectContent>
              </Select>
            ))}
            {text('agentName', tw('fields.agentName'), 60)}
            {text('avatarUrl', tw('fields.avatarUrl'))}
            {field('greeting', tw('fields.greeting'), ({ id, invalid }) => (
              <Textarea
                id={id}
                rows={2}
                maxLength={300}
                value={form.greeting}
                aria-invalid={invalid}
                onChange={(event) => set('greeting')(event.target.value)}
              />
            ))}
            {field('phonePrompt', tw('fields.phonePrompt'), ({ id, invalid }) => (
              <Textarea
                id={id}
                rows={2}
                maxLength={300}
                value={form.phonePrompt}
                aria-invalid={invalid}
                onChange={(event) => set('phonePrompt')(event.target.value)}
              />
            ))}
            {text('phoneChipText', tw('fields.phoneChipText'), 60)}
            {field('requirePhoneAfter', tw('fields.requirePhoneAfter'), ({ id, invalid }) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={20}
                value={form.requirePhoneAfter}
                aria-invalid={invalid}
                onChange={(event) => set('requirePhoneAfter')(event.target.value)}
              />
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                {t('channelInbox.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : null}
                {t('channelInbox.integrations.save')}
              </Button>
            </DialogFooter>
          </form>
          <WebsitePreview settings={previewSettings} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
