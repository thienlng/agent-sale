import { Moon, RotateCcw, Settings2, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

/** Theme, colour and layout settings for this browser (Studio Admin model). */
export function LayoutControls() {
  const { t } = useTranslation();
  const preset = usePreferences().theme_preset;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('preferences.title')}
          title={t('preferences.title')}
        >
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold">{t('preferences.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('preferences.subtitle')}</p>
          </div>

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

          <Choice name="theme_mode" />
          <Choice name="sidebar_variant" />
          <Choice name="sidebar_collapsible" />
          <Choice name="content_layout" />
          <Choice name="navbar_style" />

          <Button variant="outline" size="sm" onClick={resetPreferences}>
            <RotateCcw />
            {t('preferences.reset')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Quick light/dark switch next to the layout controls. */
export function ThemeToggle() {
  const { t } = useTranslation();
  usePreferences();
  const dark = document.documentElement.classList.contains('dark');
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('preferences.toggleTheme')}
      title={t('preferences.toggleTheme')}
      onClick={() => setPreference('theme_mode', dark ? 'light' : 'dark')}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
