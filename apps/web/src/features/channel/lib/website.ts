import { Hostname, WebsiteSettings } from '@agent-sales/contracts';

/** Script tag the site owner pastes before `</body>`; the key is the public site key. */
export function embedCode(siteKey: string, widgetUrl: string): string {
  return `<script src="${widgetUrl}?key=${siteKey}" async></script>`;
}

export interface ParsedDomains {
  /** Normalised (trimmed, lower-case) unique hosts accepted by the contract. */
  valid: string[];
  /** Entries as typed that are not a bare host (scheme, path, port, spaces...). */
  invalid: string[];
}

/** Domains typed as a comma / space / line separated list. */
export function parseDomains(text: string): ParsedDomains {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const parsed = Hostname.safeParse(raw);
    if (!parsed.success) invalid.push(raw);
    else if (!valid.includes(parsed.data)) valid.push(parsed.data);
  }
  return { valid, invalid };
}

/** Editable (string) shape of the settings form. */
export interface SettingsForm {
  domains: string;
  color: string;
  position: 'left' | 'right';
  agentName: string;
  avatarUrl: string;
  greeting: string;
  phonePrompt: string;
  phoneChipText: string;
  requirePhoneAfter: string;
}

export function toForm(s: WebsiteSettings): SettingsForm {
  return {
    domains: s.domains.join(', '),
    color: s.color,
    position: s.position,
    agentName: s.agentName,
    avatarUrl: s.avatarUrl ?? '',
    greeting: s.greeting,
    phonePrompt: s.phonePrompt,
    phoneChipText: s.phoneChipText,
    requirePhoneAfter: String(s.requirePhoneAfter),
  };
}

export type SettingsValidation =
  | { ok: true; settings: WebsiteSettings }
  | { ok: false; errors: Partial<Record<keyof SettingsForm, true>> };

/** Validates the form with the contract schema (the server applies the same rules). */
export function validateSettingsForm(form: SettingsForm): SettingsValidation {
  const { valid, invalid } = parseDomains(form.domains);
  const parsed = WebsiteSettings.safeParse({
    domains: invalid.length ? [...valid, ...invalid] : valid,
    color: form.color,
    position: form.position,
    agentName: form.agentName,
    avatarUrl: form.avatarUrl.trim() || null,
    greeting: form.greeting,
    phonePrompt: form.phonePrompt,
    phoneChipText: form.phoneChipText,
    requirePhoneAfter: form.requirePhoneAfter.trim() === '' ? NaN : Number(form.requirePhoneAfter),
  });
  if (parsed.success) return { ok: true, settings: parsed.data };
  const errors: Partial<Record<keyof SettingsForm, true>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && field in form) errors[field as keyof SettingsForm] = true;
  }
  return { ok: false, errors };
}

/** Fields of `next` that differ from `current`: the body of a minimal PATCH. */
export function diffSettings(
  current: WebsiteSettings,
  next: WebsiteSettings,
): Partial<WebsiteSettings> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof WebsiteSettings)[]) {
    const a = JSON.stringify(current[key]);
    const b = JSON.stringify(next[key]);
    if (a !== b) changed[key] = next[key];
  }
  return changed as Partial<WebsiteSettings>;
}

/** Stored settings, or the contract defaults for a site that has none yet. */
export function settingsOf(settings: WebsiteSettings | null | undefined): WebsiteSettings {
  return (
    settings ?? {
      domains: [],
      color: '#F97316',
      position: 'right',
      agentName: 'Tư vấn viên',
      avatarUrl: null,
      greeting: 'Chào anh/chị, em có thể hỗ trợ gì ạ?',
      phonePrompt: 'Anh/chị để lại số điện thoại để bên em gọi tư vấn kỹ hơn nhé.',
      phoneChipText: 'Gửi số điện thoại để được gọi lại',
      requirePhoneAfter: 0,
    }
  );
}
