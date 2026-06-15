import { STAKING_TIERS, type StakingTier } from '@lemur/shared';

/** Runtime tier whitelist guard reusing the shared source of truth. */
export function isKnownTier(value: unknown): value is StakingTier {
  return (
    typeof value === 'string' &&
    (STAKING_TIERS as readonly string[]).includes(value)
  );
}
