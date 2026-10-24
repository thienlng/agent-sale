/**
 * The bot home's onboarding steps, in the order a new owner should do them:
 * connecting a channel comes first (the owner asked for it), then the data the
 * bot answers from.
 */
export type SetupStepKey = 'channel' | 'products' | 'scenarios' | 'faqs';

export const SETUP_STEP_TARGETS = {
  channel: '/app/bots/$botId/integrations',
  products: '/app/bots/$botId/products',
  scenarios: '/app/bots/$botId/instructions',
  faqs: '/app/bots/$botId/knowledge',
} as const satisfies Record<SetupStepKey, string>;

export interface SetupStep {
  key: SetupStepKey;
  to: (typeof SETUP_STEP_TARGETS)[SetupStepKey];
  done: boolean;
}

export interface SetupInput {
  botId: string;
  channels: ReadonlyArray<{ botId: string | null; status: string }>;
  productCount: number;
  trainingKinds: readonly string[];
  faqCount: number;
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const done: Record<SetupStepKey, boolean> = {
    channel: input.channels.some((c) => c.botId === input.botId && c.status === 'connected'),
    products: input.productCount > 0,
    scenarios: input.trainingKinds.includes('scenario'),
    faqs: input.faqCount > 0,
  };
  return (Object.keys(SETUP_STEP_TARGETS) as SetupStepKey[]).map((key) => ({
    key,
    to: SETUP_STEP_TARGETS[key],
    done: done[key],
  }));
}
