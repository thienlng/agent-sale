import { lintSkill } from '@agent-sales/ai-core';

import { AssistantSkillConflictError } from '../domain/assistant.errors.js';
import type {
  AssistantRepository,
  OwnerKey,
  SkillRecord,
  SkillState,
} from '../domain/ports/assistant.repository.js';
import type { SkillCatalog } from './skill-catalog.js';

/** Active or pending owner and learned skills an owner may have (shadows are not counted). */
export const SKILL_LIMIT = 50;

/** The states that count towards the limit and hold a name. */
export const LIVE_STATES: SkillState[] = ['active', 'pending_approval'];
export const isLive = (state: SkillState): boolean => LIVE_STATES.includes(state);

/** `lintSkill` on a row's fields (rows carry no version). */
export const lintRow = (x: {
  name: string;
  description: string;
  body: string;
  toolsets: string[];
}) => lintSkill({ ...x, version: 1 });

/** The bounds every skill write checks: names, the 50-skill limit, one shadow per platform skill. */
export class SkillRules {
  constructor(
    readonly repo: AssistantRepository,
    readonly platform: SkillCatalog,
  ) {}

  /** A platform skill's name, or a non-archived row's, is taken. */
  async nameTaken(s: OwnerKey, name: string): Promise<boolean> {
    return Boolean(this.platform.get(name)) || (await this.repo.getSkillByName(s, name)) !== null;
  }

  async atLimit(s: OwnerKey): Promise<boolean> {
    const live = await this.repo.listSkills(s, {
      states: LIVE_STATES,
      provenance: ['owner', 'learned'],
    });
    return live.length >= SKILL_LIMIT;
  }

  /** At most one non-archived shadow per platform skill. */
  async shadowExists(s: OwnerKey, platformName: string): Promise<boolean> {
    const shadows = await this.repo.listSkills(s, {
      states: ['pending_approval', 'active', 'stale'],
      provenance: ['shadow'],
    });
    return shadows.some((x) => x.shadowOf === platformName);
  }

  /** A stale or archived skill coming back: the limits that apply to a new one. */
  async guardRevive(s: OwnerKey, row: SkillRecord): Promise<void> {
    if (row.provenance === 'shadow') {
      if (row.shadowOf && (await this.shadowExists(s, row.shadowOf))) {
        throw new AssistantSkillConflictError('shadow_exists');
      }
      return;
    }
    if (await this.atLimit(s)) throw new AssistantSkillConflictError('skill_limit');
  }
}
