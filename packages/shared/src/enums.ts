/**
 * Shared enums and string-literal unions for Lemur Tap.
 * These are the single source of truth for upgrade types, staking tiers,
 * ledger entry types and referral sources used by both API and webapp.
 */

/** Upgrade branches. See spec/app/04-economy.md. */
export type UpgradeType =
  | 'maxEnergy'
  | 'energyRegen'
  | 'couponMult'
  | 'vault';

export const UPGRADE_TYPES = [
  'maxEnergy',
  'energyRegen',
  'couponMult',
  'vault',
] as const;

export function isUpgradeType(value: unknown): value is UpgradeType {
  return (
    typeof value === 'string' &&
    (UPGRADE_TYPES as readonly string[]).includes(value)
  );
}

/** Staking tiers. See spec/app/08-staking.md. */
export type StakingTier = 'flex' | 'lock';

export const STAKING_TIERS = ['flex', 'lock'] as const;

export function isStakingTier(value: unknown): value is StakingTier {
  return (
    typeof value === 'string' &&
    (STAKING_TIERS as readonly string[]).includes(value)
  );
}

/**
 * Staking boosts — per-position, leveled perks bought for coins and bound to a
 * single active position (they die when the position is unstaked). See
 * spec/app/08-staking.md.
 *   - `rate`     ⚡ Ускоритель  — multiplies the position's daily yield rate.
 *   - `capacity` 🗄 Расширение  — multiplies the position's storage cap.
 *   - `unfreeze` 🔓 Разморозка  — reduces the early-exit penalty of a locked tier.
 */
export type StakingBoost = 'rate' | 'capacity' | 'unfreeze';

export const STAKING_BOOSTS = ['rate', 'capacity', 'unfreeze'] as const;

export function isStakingBoost(value: unknown): value is StakingBoost {
  return (
    typeof value === 'string' &&
    (STAKING_BOOSTS as readonly string[]).includes(value)
  );
}

/** Ledger entry types — every coin movement. See spec/app/03-data-model.md. */
export type LedgerType =
  | 'coupon'
  | 'coupon_boost'
  | 'daily'
  | 'stake'
  | 'unstake'
  | 'stake_yield'
  | 'stake_boost'
  | 'referral'
  | 'upgrade'
  | 'basket_purchase'
  | 'skin_purchase';

export const LEDGER_TYPES = [
  'coupon',
  'coupon_boost',
  'daily',
  'stake',
  'unstake',
  'stake_yield',
  'stake_boost',
  'referral',
  'upgrade',
  'basket_purchase',
  'skin_purchase',
] as const;

/**
 * Referral source — only set when LedgerType === 'referral', otherwise null.
 * Distinguishes one-off bonuses from passive minting. See spec/app/09-referral.md.
 */
export type RefSource = 'join' | 'premium' | 'passive';

export const REF_SOURCES = ['join', 'premium', 'passive'] as const;

/** Coupon game session lifecycle. See spec/app/06-coupon-game.md. */
export type CouponSessionStatus =
  | 'active'
  | 'finished'
  | 'rejected'
  | 'expired'
  // Orphaned active round, superseded & refunded by a later start() (e.g. after
  // a server restart dropped the client's finish). See coupon.service.ts.
  | 'abandoned';

/** Stake lifecycle. See spec/app/08-staking.md. */
export const STAKE_STATUSES = ['active', 'closed'] as const;

export type StakeStatus = (typeof STAKE_STATUSES)[number];
