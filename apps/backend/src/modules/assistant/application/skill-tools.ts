import { type RunnableTool, type ToolDefinition } from '@agent-sales/ai-core';
import { z } from 'zod';

import type { OwnerKey } from '../domain/ports/assistant.repository.js';
import type { SkillWriteActor, SkillWriteContext } from './skill-manage.js';
export { SkillCatalog } from './skill-catalog.js';
import type { SkillsService } from './skills.service.js';

export const SKILLS_LIST_TOOL = 'skills_list';
export const LOAD_SKILL_TOOL = 'load_skill';
export const SKILL_MANAGE_TOOL = 'skill_manage';
/** The toolset `skill_manage` belongs to (spec §6). */
export const SKILLS_TOOLSET = 'skills';

const SkillsListInput = z.object({});
const LoadSkillInput = z.object({ name: z.string().max(64) });
const SkillManageInput = z.object({
  action: z.enum(['create', 'patch', 'archive']),
  name: z.string().max(64),
  description: z.string().max(120).optional(),
  body: z.string().max(8000).optional(),
  reason: z.string().max(300).optional(),
});

const MANAGE_DESCRIPTION: Record<SkillWriteActor, string> = {
  assistant:
    'Save or improve one of the owner’s own skills (a step-by-step procedure). create: ONLY when ' +
    'the owner explicitly asks to save a procedure ("lưu thành quy trình"); needs name ' +
    '(lowercase-with-dashes), description (one line, ≤ 120 chars) and body (the steps). patch: ' +
    'change the description or body of an owner or learned skill you loaded with load_skill in ' +
    'this turn. Platform skills cannot be changed (the owner customises them on the skills page). ' +
    'Instructions only: no links outside /app, no secrets, no customer data.',
  review:
    'Save what this conversation taught about how this owner wants a class of task done. create: ' +
    'a new learned skill (name lowercase-with-dashes, description ≤ 120 chars, body = the steps); ' +
    'it waits for the owner’s approval. patch: change the description or body of a learned ' +
    'skill you loaded with load_skill in this run (a draft waiting for approval included). ' +
    'archive: retire a learned skill that is wrong or obsolete. Platform skills, the owner’s ' +
    'own skills and pinned skills cannot be changed. No customer data, links or secrets.',
};

/** The `skill_manage` definition as the given actor sees it. */
export const skillManageDefinition = (actor: SkillWriteActor): ToolDefinition => ({
  name: SKILL_MANAGE_TOOL,
  description: MANAGE_DESCRIPTION[actor],
  input: SkillManageInput,
});

export const SKILL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: SKILLS_LIST_TOOL,
    description: 'List the skills (step-by-step guides) by name and description.',
    input: SkillsListInput,
  },
  {
    name: LOAD_SKILL_TOOL,
    description:
      'Load a skill by name before guiding the owner through that task; returns its procedure.',
    input: LoadSkillInput,
  },
  skillManageDefinition('assistant'),
];

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

/** One run's skill tools: the owner, the actor and the skills loaded so far. */
export interface SkillToolContext extends SkillWriteContext {
  scope: OwnerKey;
  skills: SkillsService;
  /**
   * Toolsets this turn does not have (the SQL lane when it is not configured or turned off). A
   * skill that needs only those loads as `toolset_unavailable` with what to do instead (AS-5).
   */
  unavailableToolsets?: ReadonlySet<string>;
}

/** Told to the model when a skill's toolsets are all missing this turn (AS-5). */
export const TOOLSET_UNAVAILABLE_GUIDANCE =
  'This skill needs tools that are not available here (data analysis over SQL is off). Do not search for them. Answer from the read tools tool_search finds (orders, products, bookings, summaries) when they cover the question; otherwise say once, plainly, that this analysis or chart is not available yet. Never draw a chart in text.';

/**
 * skills_list and load_skill over the owner's catalog (platform skills, shadows in their place,
 * then the owner's active rows), and skill_manage for the actor of the run. load_skill records
 * the name in `loadedSkills` (read-before-write) and bumps a row's use counter.
 */
export function skillTools(ctx: SkillToolContext): RunnableTool[] {
  const list: RunnableTool = {
    name: SKILLS_LIST_TOOL,
    readOnly: true,
    schema: SkillsListInput,
    async run() {
      const catalog = await ctx.skills.catalog(ctx.scope);
      const skills = catalog.entries.map((s) => ({ name: s.name, description: s.description }));
      return { content: json({ skills }) };
    },
  };
  const load: RunnableTool = {
    name: LOAD_SKILL_TOOL,
    readOnly: true,
    schema: LoadSkillInput,
    async run(input) {
      const { name } = input as z.output<typeof LoadSkillInput>;
      // The review may also load a learned draft waiting for approval (ruling 1c-R7).
      const skill = await ctx.skills.load(ctx.scope, name.trim(), {
        includePending: ctx.actor === 'review',
      });
      if (!skill) return { content: json({ ok: false, errorCode: 'unknown_skill' }), ok: false };
      const missing = ctx.unavailableToolsets;
      if (missing && skill.toolsets.length > 0 && skill.toolsets.every((t) => missing.has(t))) {
        return {
          content: json({
            ok: false,
            errorCode: 'toolset_unavailable',
            name: skill.name,
            toolsets: skill.toolsets,
            guidance: TOOLSET_UNAVAILABLE_GUIDANCE,
          }),
          ok: false,
        };
      }
      ctx.loadedSkills.add(skill.name);
      return {
        content: json({ ok: true, name: skill.name, toolsets: skill.toolsets, body: skill.body }),
      };
    },
  };
  const manage: RunnableTool = {
    name: SKILL_MANAGE_TOOL,
    readOnly: false,
    schema: SkillManageInput,
    async run(input) {
      const out = await ctx.skills.manage(
        ctx.scope,
        ctx,
        input as z.output<typeof SkillManageInput>,
      );
      return out.ok ? { content: json(out) } : { content: json(out), ok: false };
    },
  };
  return [list, load, manage];
}
