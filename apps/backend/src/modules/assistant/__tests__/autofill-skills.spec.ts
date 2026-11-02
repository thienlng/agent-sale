import { ASSISTANT_SKILLS_DIR, lintSkill, loadSkillDir, type SkillDoc } from '@agent-sales/ai-core';
import { PROFILE_FIELDS, profileFieldsFor } from '@agent-sales/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

/** Skills added by capability 6, shop information autofill (T-175). */
const TASK_SKILLS = ['draft-reply-guidance', 'fill-sample-data', 'fill-shop-info'];
const INDUSTRY_SKILLS = {
  retail: 'industry-retail',
  hotel: 'industry-hotel',
  saas: 'industry-saas',
};

/**
 * Form ids the web app registers with `useAssistantForm` for this capability. Keep in sync with
 * apps/web/src/features: knowledge/components/{business-profile-form,faq-list,faq-dialog,
 * personality-card,rules-list,training-items,quick-reply-list,quick-reply-dialog}.tsx,
 * bot/components/{bot-list,create-bot-dialog}.tsx and
 * workspace/components/{create-business-page,profile-page}.tsx.
 */
const REGISTERED_FORMS = [
  'bot',
  'bot-personality',
  'bot-profile',
  'business',
  'business-settings',
  'faq',
  'quick-reply',
  'scenario',
];

const PROFILE_KEYS = new Set<string>(PROFILE_FIELDS.map((f) => f.key));
/** A Vietnamese phone number, the same shape the safety scanner flags. */
const VN_PHONE = /(?<!\d)(?:\+84|0)[\s.]?[35789](?:[\s.]?\d){8}(?!\d)/;

const backticked = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

describe('shop autofill skills (T-175)', () => {
  let skills: Map<string, SkillDoc>;
  beforeAll(async () => {
    skills = new Map((await loadSkillDir(ASSISTANT_SKILLS_DIR)).map((s) => [s.name, s]));
  });
  const body = (name: string): string => {
    const skill = skills.get(name);
    if (!skill) throw new Error(`missing skill ${name}`);
    return skill.body;
  };

  it('loads the six new skills, lint clean, for the ui and routes toolsets', () => {
    for (const name of [...TASK_SKILLS, ...Object.values(INDUSTRY_SKILLS)]) {
      const skill = skills.get(name);
      expect(skill, name).toBeDefined();
      expect(lintSkill(skill!), name).toEqual([]);
      expect(skill!.toolsets, name).toEqual(['ui', 'routes']);
      expect(skill!.body.startsWith(`# `), name).toBe(true);
      expect(skill!.body, name).toContain('Use this when');
    }
  });

  it('moves set-up-bot to version 2, pointing at the new skills', () => {
    const setUp = skills.get('set-up-bot')!;
    expect(setUp.version).toBe(2);
    for (const name of ['draft-reply-guidance', 'fill-shop-info', 'fill-sample-data']) {
      expect(setUp.body).toContain(name);
    }
  });

  it.each(Object.entries(INDUSTRY_SKILLS))(
    'names exactly the profile keys of the %s industry',
    (industry, name) => {
      const allowed = new Set<string>(profileFieldsFor(industry).map((f) => f.key));
      const mentioned = new Set(backticked(body(name)).filter((w) => PROFILE_KEYS.has(w)));
      for (const key of mentioned) expect(allowed.has(key), `${name}: ${key}`).toBe(true);
      const own = profileFieldsFor(industry).filter((f) => f.group === 'industry');
      for (const f of own) expect(mentioned.has(f.key), `${name}: ${f.key}`).toBe(true);
      expect(mentioned.has('mapsUrl')).toBe(false);
    },
  );

  it('names only registered form ids, and every registered form somewhere', () => {
    const named = new Set<string>();
    for (const name of TASK_SKILLS) {
      for (const m of body(name).matchAll(/`([a-z-]+)` form/g)) {
        expect(REGISTERED_FORMS, `${name}: ${m[1]}`).toContain(m[1]);
        named.add(m[1]!);
      }
    }
    expect([...named].sort()).toEqual(REGISTERED_FORMS);
  });

  it('keeps links, template placeholders and phone numbers out of every platform skill', () => {
    for (const skill of skills.values()) {
      const text = [skill.description, skill.body].join('\n');
      // No links ("HTTPS only" in set-up-api-action names the scheme, not a link).
      expect(text, skill.name).not.toMatch(/https?:\/\/|www\./i);
      expect(text, skill.name).not.toContain('{{');
      expect(text, skill.name).not.toMatch(VN_PHONE);
    }
  });
});
