import { ASSISTANT_SKILLS_DIR, lintSkill, loadSkillDir } from '@agent-sales/ai-core';
import { describe, expect, it } from 'vitest';

import {
  LOAD_SKILL_TOOL,
  SKILL_TOOL_DEFINITIONS,
  SKILLS_LIST_TOOL,
  SkillCatalog,
  skillTools,
} from '../application/skill-tools.js';

const PLATFORM_SKILLS = [
  'add-products',
  'answer-data-questions',
  'connect-channels',
  'handle-orders',
  'read-revenue',
  'set-up-bot',
];

describe('platform skills', () => {
  it('load from the real folder and pass the linter', async () => {
    const skills = await loadSkillDir(ASSISTANT_SKILLS_DIR);
    expect(skills.map((s) => s.name)).toEqual(PLATFORM_SKILLS);
    for (const skill of skills) {
      expect(lintSkill(skill)).toEqual([]);
      expect(skill.toolsets.length).toBeGreaterThan(0);
      expect(skill.toolsets.every((t) => t === 'ui' || t === 'routes' || t === 'sql')).toBe(true);
      // Every page a skill names is a dashboard path.
      for (const path of skill.body.match(/\/app[^\s,.;)]*/g) ?? []) {
        expect(path).toMatch(/^\/app(\/[a-z{}A-Z-]+)*$/);
      }
    }
  });
});

describe('skill tools', () => {
  async function setup() {
    const catalog = await SkillCatalog.load();
    const tools = skillTools(catalog);
    const run = async (name: string, input: unknown) => {
      const tool = tools.find((t) => t.name === name)!;
      const out = await tool.run(tool.schema.parse(input));
      const parsed: Record<string, unknown> = {
        ok: out.ok ?? true,
        ...(JSON.parse(out.content) as object),
      };
      return parsed;
    };
    return { catalog, tools, run };
  }

  it('offers skills_list and load_skill, with a definition for each', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => t.name)).toEqual([SKILLS_LIST_TOOL, LOAD_SKILL_TOOL]);
    expect(SKILL_TOOL_DEFINITIONS.map((d) => d.name)).toEqual(tools.map((t) => t.name));
    expect(tools.every((t) => t.readOnly)).toBe(true);
  });

  it('lists the skills and loads one body, or answers unknown_skill', async () => {
    const { run, catalog } = await setup();
    const list = await run(SKILLS_LIST_TOOL, {});
    expect((list.skills as { name: string }[]).map((s) => s.name)).toEqual(PLATFORM_SKILLS);
    const loaded = await run(LOAD_SKILL_TOOL, { name: 'handle-orders' });
    expect(loaded).toMatchObject({ ok: true, name: 'handle-orders' });
    expect(loaded.body).toBe(catalog.get('handle-orders')!.body);
    expect(await run(LOAD_SKILL_TOOL, { name: 'nope' })).toEqual({
      ok: false,
      errorCode: 'unknown_skill',
    });
  });

  it('renders a byte-stable index sorted by name', async () => {
    const { catalog } = await setup();
    const reversed = new SkillCatalog([...catalog.list()].reverse());
    expect(reversed.index()).toBe(catalog.index());
    expect(
      catalog
        .index()
        .split('\n')
        .map((l) => l.split(':')[0]),
    ).toEqual(PLATFORM_SKILLS.map((n) => `- ${n}`));
  });
});
