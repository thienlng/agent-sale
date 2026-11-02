import {
  ASSISTANT_SKILLS_DIR,
  loadSkillDir,
  renderSkillIndex,
  type SkillDoc,
} from '@agent-sales/ai-core';

import type { SkillProvenance } from '../domain/ports/assistant.repository.js';

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

/** One skill the model can load: a platform file, or an owner's active row. */
export interface CatalogSkill {
  name: string;
  description: string;
  toolsets: string[];
  body: string;
  provenance: 'platform' | SkillProvenance;
  /** The row behind it; null for a platform skill. */
  rowId: string | null;
}

/**
 * The skills one owner's assistant sees: the platform skills, where an active `shadow` row
 * replaces the platform skill it copies, plus the owner's other active rows. Sorted by name.
 */
export class OwnerSkillCatalog {
  readonly entries: readonly CatalogSkill[];

  constructor(entries: CatalogSkill[]) {
    this.entries = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  get(name: string): CatalogSkill | undefined {
    return this.entries.find((x) => x.name === name);
  }

  /** `- <name>: <description>` lines, no provenance marker: byte-stable for prompt caching. */
  index(): string {
    return renderSkillIndex([...this.entries]);
  }
}
