import { ASSISTANT_SKILLS_DIR, lintSkill, loadSkillDir } from '@agent-sales/ai-core';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import {
  LOAD_SKILL_TOOL,
  SKILL_MANAGE_TOOL,
  SKILL_TOOL_DEFINITIONS,
  SKILLS_LIST_TOOL,
  SkillCatalog,
  skillTools,
} from '../application/skill-tools.js';
import { SkillsService } from '../application/skills.service.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const PLATFORM_SKILLS = [
  'add-products',
  'answer-data-questions',
  'bot-doctor',
  'connect-channels',
  'draft-reply-guidance',
  'fill-sample-data',
  'fill-shop-info',
  'handle-orders',
  'import-products',
  'industry-hotel',
  'industry-retail',
  'industry-saas',
  'read-revenue',
  'set-up-api-action',
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

describe('capability 5 skills', () => {
  it('bot-doctor and set-up-api-action drive the route and ui tools', async () => {
    const skills = await loadSkillDir(ASSISTANT_SKILLS_DIR);
    const doctor = skills.find((s) => s.name === 'bot-doctor')!;
    const action = skills.find((s) => s.name === 'set-up-api-action')!;
    for (const s of [doctor, action]) expect([...s.toolsets].sort()).toEqual(['routes', 'ui']);
    expect(doctor.body).toContain('GET /bots/{botId}/turns');
    expect(doctor.body).toContain('Rapiz chỉ giữ chi tiết 30 ngày');
    expect(action.body).toContain('enabled: always false');
    expect(action.body).toContain('actions.secret');
    expect(skills.find((s) => s.name === 'set-up-bot')).toMatchObject({ version: 2 });
  });
});

describe('skill tools', () => {
  async function setup() {
    const catalog = await SkillCatalog.load();
    const repo = new InMemoryAssistantRepository();
    const business = workspaceId(newId());
    const scope = {
      accountId: newId(),
      ownerUserId: userId(newId()),
      businessId: business,
      businessIds: [business],
    };
    const tools = skillTools({
      scope,
      skills: new SkillsService(repo, catalog),
      actor: 'assistant',
      runId: null,
      loadedSkills: new Set(),
    });
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

  it('offers skills_list, load_skill and skill_manage, with a definition for each', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => t.name)).toEqual([
      SKILLS_LIST_TOOL,
      LOAD_SKILL_TOOL,
      SKILL_MANAGE_TOOL,
    ]);
    expect(SKILL_TOOL_DEFINITIONS.map((d) => d.name)).toEqual(tools.map((t) => t.name));
    expect(tools.filter((t) => t.readOnly).map((t) => t.name)).toEqual([
      SKILLS_LIST_TOOL,
      LOAD_SKILL_TOOL,
    ]);
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
