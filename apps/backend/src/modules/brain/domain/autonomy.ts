import type { AutonomyAction, AutonomyLevel } from '@agent-sales/contracts';

export type { AutonomyAction, AutonomyLevel };

/** One action of the registry: its default level and the levels a business may choose. */
export interface AutonomyRule {
  default: AutonomyLevel;
  levels: readonly AutonomyLevel[];
}

/**
 * The autonomy registry (spec 2026-11-11 care §5, ADR-031): how much the AI may do on its own per
 * kind of action. Every business starts at `suggest` (owner decision 2026-11-11).
 */
export const AUTONOMY_REGISTRY: Readonly<Record<AutonomyAction, AutonomyRule>> = {
  'care.send_message': { default: 'suggest', levels: ['suggest', 'act_and_report', 'auto'] },
};

/** The level in force: the stored one when the action allows it, else the action's default. */
export function resolveLevel(action: AutonomyAction, stored: AutonomyLevel | null): AutonomyLevel {
  const rule = AUTONOMY_REGISTRY[action];
  return stored !== null && rule.levels.includes(stored) ? stored : rule.default;
}

/** Whether `level` lets the AI send on its own (not only draft for a person). */
export function sendsOnItsOwn(level: AutonomyLevel): boolean {
  return level !== 'suggest';
}
