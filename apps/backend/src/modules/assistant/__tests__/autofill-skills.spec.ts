import { ASSISTANT_SKILLS_DIR, lintSkill, loadSkillDir, type SkillDoc } from '@agent-sales/ai-core';
import { PROFILE_FIELDS, profileFieldsFor } from '@agent-sales/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

/** Skills added by capability 6, shop information autofill (T-175). */
const TASK_SKILLS = ['draft-reply-guidance', 'fill-sample-data', 'fill-shop-info'];
const INDUSTRY_SKILLS = {
  retail: 'industry-retail',
  hotel: 'industry-hotel',
  saas: 'industry-saas',
  education: 'industry-education',
  spa: 'industry-spa',
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

  it('loads the new skills, lint clean, for the ui and routes toolsets', () => {
    for (const name of [...TASK_SKILLS, ...Object.values(INDUSTRY_SKILLS)]) {
      const skill = skills.get(name);
      expect(skill, name).toBeDefined();
      expect(lintSkill(skill!), name).toEqual([]);
      expect(skill!.toolsets, name).toEqual(['ui', 'routes']);
      expect(skill!.body.startsWith(`# `), name).toBe(true);
      expect(skill!.body, name).toContain('Use this when');
    }
  });

  it('makes "Nhờ trợ lý điền mẫu" end in proposals or a fill, not chat text (QA TinyMind B7)', () => {
    const sample = skills.get('fill-sample-data')!;
    expect(sample.version).toBe(3);
    expect(sample.body).toContain('always an action, never only text');
    expect(sample.body).toContain('starts with "Điền mẫu"');
  });

  it('pages scenarios compactly, and only when drafting scenarios (QA5 #3)', () => {
    const sample = skills.get('fill-sample-data')!.body;
    expect(sample).toContain('FAQ samples read no training items');
    expect(sample).toContain('kind=scenario, fields=summary, limit=20');
    expect(sample).not.toContain('its training items');
  });

  it('reads one compact catalog page and at most 2 sibling bots before filling (QA retest N1)', () => {
    const fill = skills.get('fill-shop-info')!;
    expect(fill.version).toBe(4);
    expect(fill.body).toContain('GET /products with fields=summary and pageSize=20');
    expect(fill.body).toContain('Read no further page and no product detail');
    expect(fill.body).not.toContain('every next page');
    expect(fill.body).toContain('read at most 2 of them (GET /bots/{botId})');
    expect(fill.body).toContain('business-level Rapiz data (address, hotline, hours, branches');
  });

  it('moves set-up-bot to version 3, pointing at the new skills', () => {
    const setUp = skills.get('set-up-bot')!;
    expect(setUp.version).toBe(3);
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

  it('names the education and spa skills wherever the other industry skills are named (T-187)', () => {
    for (const name of [
      'set-up-bot',
      'draft-reply-guidance',
      'fill-shop-info',
      'fill-sample-data',
    ]) {
      expect(body(name), name).toContain('industry-education or industry-spa');
    }
    for (const name of ['industry-education', 'industry-spa']) {
      const text = body(name);
      expect(text, name).toContain('## Sources in Rapiz');
      expect(text, name).toContain('GET /products');
      expect(text, name).toContain('`offering`');
      expect(text, name).toContain('GET /crm/requests/summary');
      expect(text, name).toContain('## Never');
    }
    // The quick-reply shortcuts of the demo seed contract (spec §9.6).
    for (const s of ['hocphi', 'lichhoc', 'hocthu', 'coso', 'uudai']) {
      expect(body('industry-education')).toContain(`- ${s}: `);
    }
    for (const s of ['banggia', 'datlich', 'doilich', 'coso', 'uudai']) {
      expect(body('industry-spa')).toContain(`- ${s}: `);
    }
    expect(body('add-products')).toContain('priceNote');
    // The product form's offering fields, so a schedule never lands in the description (N3).
    expect(body('add-products')).toContain('"lịch học sáng thứ 7" in schedule');
    expect(body('import-products')).toContain('a course or service gets no stock');
    expect(body('answer-data-questions')).toContain('customer_requests where not is_update');
    expect(body('read-revenue')).toContain('Never present requests as revenue');
  });

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
