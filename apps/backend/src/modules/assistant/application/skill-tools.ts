import {
  ASSISTANT_SKILLS_DIR,
  loadSkillDir,
  renderSkillIndex,
  type RunnableTool,
  type SkillDoc,
  type ToolDefinition,
} from '@agent-sales/ai-core';
import { z } from 'zod';

export const SKILLS_LIST_TOOL = 'skills_list';
export const LOAD_SKILL_TOOL = 'load_skill';

const SkillsListInput = z.object({});
const LoadSkillInput = z.object({ name: z.string().max(64) });

export const SKILL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: SKILLS_LIST_TOOL,
    description: 'List the platform skills (step-by-step guides) by name and description.',
    input: SkillsListInput,
  },
  {
    name: LOAD_SKILL_TOOL,
    description:
      'Load a skill by name before guiding the owner through that task; returns its procedure.',
    input: LoadSkillInput,
  },
];

/**
 * The platform skills (`packages/ai-core/assistant-skills`, ruling 1b-R3), parsed and linted
 * once when the module starts (an async provider factory); a bad skill fails the boot, as a
 * bad prompt would.
 */
export class SkillCatalog {
  readonly #skills: readonly SkillDoc[];
  readonly #index: string;

  constructor(skills: readonly SkillDoc[]) {
    const sorted = [...skills].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.#skills = sorted;
    this.#index = renderSkillIndex(sorted);
  }

  static async load(dir: string = ASSISTANT_SKILLS_DIR): Promise<SkillCatalog> {
    return new SkillCatalog(await loadSkillDir(dir));
  }

  /** Sorted by name. */
  list(): readonly SkillDoc[] {
    return this.#skills;
  }

  get(name: string): SkillDoc | undefined {
    return this.#skills.find((s) => s.name === name);
  }

  /** `- <name>: <description>` lines for the system prompt (byte-stable). */
  index(): string {
    return this.#index;
  }
}

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

/** skills_list and load_skill over the catalog; both read only. */
export function skillTools(catalog: SkillCatalog): RunnableTool[] {
  const list: RunnableTool = {
    name: SKILLS_LIST_TOOL,
    readOnly: true,
    schema: SkillsListInput,
    run() {
      const skills = catalog.list().map((s) => ({ name: s.name, description: s.description }));
      return Promise.resolve({ content: json({ skills }) });
    },
  };
  const load: RunnableTool = {
    name: LOAD_SKILL_TOOL,
    readOnly: true,
    schema: LoadSkillInput,
    run(input) {
      const { name } = input as z.output<typeof LoadSkillInput>;
      const skill = catalog.get(name.trim());
      if (!skill) {
        return Promise.resolve({
          content: json({ ok: false, errorCode: 'unknown_skill' }),
          ok: false,
        });
      }
      return Promise.resolve({
        content: json({ ok: true, name: skill.name, toolsets: skill.toolsets, body: skill.body }),
      });
    },
  };
  return [list, load];
}
