/** Who got the signup trial of a canonical email (`canonicalMailbox`; migration 0077). */
export interface TrialClaimRepository {
  /**
   * Claims the trial of `canonicalEmail` for `userId`. True when the user holds the claim (new, or
   * already theirs); false when another user, live or deleted, got it first.
   */
  claim(canonicalEmail: string, userId: string): Promise<boolean>;
}

export const TRIAL_CLAIM_REPOSITORY = Symbol('TRIAL_CLAIM_REPOSITORY');
