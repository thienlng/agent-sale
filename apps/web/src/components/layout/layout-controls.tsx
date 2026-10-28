import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { resetPreferences, setPreference, usePreferences } from '@/lib/preferences/preferences';
import {
  PREFERENCES,
  type PreferenceKey,
  type PreferenceValues,
  PRESET_SWATCH,
} from '@/lib/preferences/registry';
import { cn } from '@/lib/utils';

/** One row of choices, as a toggle group (single choice, never empty). */
function Choice<K extends Exclude<PreferenceKey, 'theme_preset'>>({ name }: { name: K }) {
  const { t } = useTranslation();
  const value = usePreferences()[name];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground" id={`pref-${name}`}>
        {t(`preferences.${name}.label`)}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        aria-labelledby={`pref-${name}`}
        onValueChange={(v) => v && setPreference(name, v as PreferenceValues[K])}
        className="w-full *:flex-1"
      >
        {PREFERENCES[name].values.map((v) => (
          <ToggleGroupItem key={v} value={v} className="text-xs">
            {t(`preferences.${name}.${v}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** What this dialog shows and resets; light/dark mode belongs to the account menu. */
const LAYOUT_KEYS = [
  'theme_preset',
  'sidebar_variant',
  'sidebar_collapsible',
  'content_layout',
  'navbar_style',
] as const satisfies readonly PreferenceKey[];

/**
 * Colour and layout settings for this browser (Studio Admin model). Reached from the account
 * menu's display view; light/dark mode lives in that menu, so it is not repeated here.
 */
export function LayoutCustomizeDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close (the menu row that opened it is gone by then). */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}) {
  const { t } = useTranslation();
  const preset = usePreferences().theme_preset;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('preferences.title')}</DialogTitle>
          <DialogDescription>{t('preferences.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground" id="pref-theme_preset">
              {t('preferences.theme_preset.label')}
            </span>
            <div
              role="radiogroup"
              aria-labelledby="pref-theme_preset"
              className="grid grid-cols-4 gap-2"
            >
              {PREFERENCES.theme_preset.values.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={preset === p}
                  onClick={() => setPreference('theme_preset', p)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
                    preset === p && 'border-primary bg-primary-soft',
                  )}
                >
                  <span
                    className="size-5 rounded-full"
                    style={{ backgroundColor: PRESET_SWATCH[p] }}
                  />
                  {t(`preferences.theme_preset.${p}`)}
                </button>
              ))}
            </div>
          </div>

          <Choice name="sidebar_variant" />
          <Choice name="sidebar_collapsible" />
          <Choice name="content_layout" />
          <Choice name="navbar_style" />

          <Button variant="outline" size="sm" onClick={() => resetPreferences(LAYOUT_KEYS)}>
            <RotateCcw />
            {t('preferences.reset')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
