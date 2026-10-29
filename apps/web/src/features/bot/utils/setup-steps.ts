import { profileFieldsFor } from '@agent-sales/contracts';

/**
 * The bot home's onboarding steps, in the order a new owner should do them:
 * connecting a channel comes first (the owner asked for it), then the data the
 * bot answers from.
 */
export type SetupStepKey = 'channel' | 'profile' | 'products' | 'scenarios' | 'faqs';

export const SETUP_STEP_TARGETS = {
  channel: '/app/bots/$botId/integrations',
  profile: '/app/bots/$botId/knowledge',
  products: '/app/bots/$botId/products',
  scenarios: '/app/bots/$botId/instructions',
  faqs: '/app/bots/$botId/knowledge',
} as const satisfies Record<SetupStepKey, string>;

export interface SetupStep {
  key: SetupStepKey;
  to: (typeof SETUP_STEP_TARGETS)[SetupStepKey];
  done: boolean;
  /** Profile step only: how many of the industry's profile fields are still empty. */
  emptyCount?: number;
}

export interface SetupInput {
  botId: string;
  channels: ReadonlyArray<{ botId: string | null; status: string }>;
  productCount: number;
  trainingKinds: readonly string[];
  faqCount: number;
  /** `complete`: every basic business field is filled; `emptyCount`: industry fields still empty. */
  profile: { complete: boolean; emptyCount: number };
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const done: Record<SetupStepKey, boolean> = {
    channel: input.channels.some((c) => c.botId === input.botId && c.status === 'connected'),
    profile: input.profile.complete,
    products: input.productCount > 0,
    scenarios: input.trainingKinds.includes('scenario'),
    faqs: input.faqCount > 0,
  };
  return (Object.keys(SETUP_STEP_TARGETS) as SetupStepKey[]).map((key) => ({
    key,
    to: SETUP_STEP_TARGETS[key],
    done: done[key],
    ...(key === 'profile' ? { emptyCount: input.profile.emptyCount } : {}),
  }));
}

/** Basic fields every bot needs before going live; `mapsUrl` stays optional. */
const REQUIRED_PROFILE_FIELDS = ['displayName', 'address', 'hotline', 'hours'];

/** Completeness of the business profile: basics filled, and how many industry fields are empty. */
export function profileProgress(
  industry: string,
  fields: Readonly<Record<string, string | undefined>>,
): SetupInput['profile'] {
  const filled = (key: string) => Boolean(fields[key]?.trim());
  return {
    complete: REQUIRED_PROFILE_FIELDS.every(filled),
    emptyCount: profileFieldsFor(industry).filter((f) => !filled(f.key)).length,
  };
}
