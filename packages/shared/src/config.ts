/**
 * GameConfig — the economy contract.
 *
 * This file defines the TS type for the versioned server-side GameConfig row
 * and the DEFAULT_GAME_CONFIG used to seed the DB. The webapp does NOT import
 * these numbers; it fetches the live config via GET /config (see spec/app/02).
 *
 * Every number here is sourced from spec/app/04 (economy) plus the caps/limits
 * in 05 (energy), 06 (coupon), 07 (daily), 08 (staking), 09 (referral),
 * 11 (anti-cheat). Money is in whole coins; all reward/interest math floors.
 */

import * as z from 'zod';

import { STAKING_BOOSTS, STAKING_TIERS, UPGRADE_TYPES } from './enums.js';

/** Per-branch upgrade pricing parameters: price(L->L+1) = round(base * mult^L). */
export const UpgradeBranchConfigSchema = z.object({
  /** Price of the first purchase (level 0 -> 1). */
  base: z.number(),
  /** Geometric growth factor per level. */
  mult: z.number(),
  /** Effect added per level (interpretation depends on the branch). */
  perLevel: z.number(),
});

export type UpgradeBranchConfig = z.infer<typeof UpgradeBranchConfigSchema>;

/** Per-tier staking parameters (spec/app/08, staking as an offline yield engine). */
export const StakingTierConfigSchema = z.object({
  /** Daily yield rate as a fraction of principal (e.g. 0.02 = 2%/day). */
  rateDaily: z.number(),
  /** Minimum coins required to open/top-up a position of this tier. */
  minStake: z.number(),
  /** Lock term in days; 0 means flexible (no lock, withdraw anytime). */
  termDays: z.number(),
  /** Fraction of principal forfeited on early exit before unlock; 0 for flex. */
  earlyPenalty: z.number(),
});

export type StakingTierConfig = z.infer<typeof StakingTierConfigSchema>;

/**
 * Per-boost parameters (spec/app/08 §5 — staking boosts shop). A boost is a
 * leveled perk bought for coins and applied to a single active position.
 * price(L->L+1) = round(base * mult^L); `perLevel` is the fractional effect
 * added per level (interpretation depends on the boost — see StakingBoost).
 */
export const StakingBoostConfigSchema = z.object({
  /** Price of the first level (level 0 -> 1). */
  base: z.number(),
  /** Geometric growth factor per level. */
  mult: z.number(),
  /** Fractional effect added per level (e.g. 0.20 = +20% per level). */
  perLevel: z.number(),
  /** Hard cap on this boost's level for a single position. */
  maxLevel: z.number(),
});

export type StakingBoostConfig = z.infer<typeof StakingBoostConfigSchema>;

/**
 * Build a `z.object` whose keys are the given const-array members, each mapped
 * to `value`. Produces a fully-keyed record schema (no extra/missing keys).
 */
function recordOf<K extends string, V extends z.ZodType>(
  keys: readonly K[],
  value: V,
): z.ZodObject<Record<K, V>> {
  const shape = Object.fromEntries(keys.map((k) => [k, value])) as Record<K, V>;
  return z.object(shape);
}

export const GameConfigSchema = z.object({
  /** Schema/content version of this config row. */
  version: z.number(),

  // ── Base economy constants (spec/app/04) ──────────────────────────────
  /** Full energy bar at start = number of actions. */
  baseMaxEnergy: z.number(),
  /** Base energy regenerated per second. */
  energyRegen: z.number(),

  // ── Upgrades (spec/app/04) ────────────────────────────────────────────
  /** Hard cap on every branch level (against overflow / unrealistic values). */
  maxLevel: z.number(),
  /** Base coupon multiplier at level 0 (1 = 100%). */
  baseCouponMult: z.number(),
  /** Vault storage capacity at level 0, in coins/day (spec/app/08 §3.3). */
  baseVaultCapacity: z.number(),
  upgrades: recordOf(UPGRADE_TYPES, UpgradeBranchConfigSchema),

  // ── Coupon game (spec/app/04, 06, 11) ─────────────────────────────────
  /** Energy spent to enter a coupon round. */
  couponSessionCost: z.number(),
  /** Round duration in milliseconds. */
  couponSessionDurationMs: z.number(),
  /** Grace added to duration before finish is refused, in milliseconds. */
  couponFinishGraceMs: z.number(),
  /** Coins per coupon point: f(score) = score * couponCoinPerPoint. */
  couponCoinPerPoint: z.number(),
  /** Anti-fraud cap on coins awarded per round. */
  couponMaxCoins: z.number(),
  /**
   * Deterministic anti-cheat bound: max points obtainable per second of a round
   * for a given seed. Used by couponMaxScore() to compute the score ceiling.
   */
  couponMaxPointsPerSec: z.number(),
  /** Rate-limit window for coupon.*, in milliseconds. */
  couponRateLimitWindowMs: z.number(),
  /** Max coupon.* requests within the window. */
  couponRateLimitMax: z.number(),

  // ── Coupon boost consumable (spec/app/06 §"Буст") ─────────────────────
  /**
   * Coin price of the coupon boost. Tuned to roughly one round's TYPICAL payout
   * (~70–100 coins), NOT couponMaxCoins (3000) — that cap is anti-fraud, not the
   * expected reward. Buying it refills energy for one attempt.
   */
  couponBoostPrice: z.number(),
  /** Energy granted on purchase (= one round's cost; tops the bar to full). */
  couponBoostEnergyGrant: z.number(),

  // ── Daily bonus (spec/app/07) ─────────────────────────────────────────
  /**
   * Reward table indexed by day = min(streak, 7), 1-based.
   * dailyRewards[0] is day 1, dailyRewards[6] is day 7+.
   */
  dailyRewards: z.array(z.number()),

  // ── Staking (spec/app/08) ─────────────────────────────────────────────
  // One active position per tier (flex/lock); both top-uppable in place.
  staking: recordOf(STAKING_TIERS, StakingTierConfigSchema),
  // Per-position boosts shop (spec/app/08 §5). Keyed by StakingBoost.
  stakingBoosts: recordOf(STAKING_BOOSTS, StakingBoostConfigSchema),

  // ── Referral (spec/app/09, 11) ────────────────────────────────────────
  /** One-off join bonus to the referrer (refSource='join'). */
  referralJoinBonusReferrer: z.number(),
  /** One-off join bonus to the referee (refSource='join'). */
  referralJoinBonusReferee: z.number(),
  /** One-off Telegram-Premium bonus to the referrer (refSource='premium'). */
  referralPremiumBonusReferrer: z.number(),
  /** One-off Telegram-Premium bonus to the referee (refSource='premium'). */
  referralPremiumBonusReferee: z.number(),
  /** Passive share of referee coupon income minted to the referrer. */
  referralPassiveRate: z.number(),
  /** Hard cap on total passive coins a single referrer can ever earn. */
  referralPassiveCap: z.number(),
  /**
   * Legacy field kept for schema stability; no longer consulted. The referral
   * activity gate is now "referee has >=1 finished coupon session" (the tap-sum
   * proxy is gone). Value is retained to avoid a config schema break.
   */
  referralMinActivityTaps: z.number(),
  /** Max rewarded referrals per referrer per UTC day. */
  referralDailyCap: z.number(),
  /** Max rewarded referrals per referrer in total. */
  referralTotalCap: z.number(),

  // ── Auth (spec/app/11) ────────────────────────────────────────────────
  /** Max allowed age of initData auth_date, in milliseconds (anti-replay). */
  authDateMaxAgeMs: z.number(),
  /** JWT time-to-live, in seconds. */
  jwtTtlSec: z.number(),
  /** Rate-limit window for /auth/telegram, in milliseconds. */
  authRateLimitWindowMs: z.number(),
  /** Max /auth/telegram requests within the window. */
  authRateLimitMax: z.number(),
});

export type GameConfig = z.infer<typeof GameConfigSchema>;

/**
 * Default economy values seeded into the GameConfig DB row.
 * Numbers mirror spec/app/04 exactly; caps/limits from 05/06/07/08/09/11.
 */
export const DEFAULT_GAME_CONFIG: GameConfig = GameConfigSchema.parse({
  version: 6,

  // Base economy (spec/app/04). Energy now gates ONLY the coupon round, so the
  // bar IS the round cooldown: max == cost (bar holds exactly one round) and a
  // full regen at 500/3600 energy/sec takes 3600 s -> one round per hour
  // (spec/app/05).
  baseMaxEnergy: 500,
  energyRegen: 500 / 3600,

  // Upgrades (spec/app/04)
  maxLevel: 20,
  baseCouponMult: 1,
  // Vault storage capacity at L0 = 3000 coins/day (spec/app/08 §4).
  baseVaultCapacity: 3000,
  upgrades: {
    // max_energy(L) = BASE_MAX_ENERGY + 500 * L
    maxEnergy: { base: 2000, mult: 1.8, perLevel: 500 },
    // energy_regen(L) = ENERGY_REGEN + 0.5 * L
    energyRegen: { base: 5000, mult: 2.0, perLevel: 0.5 },
    // coupon_mult(L) = 1 + 0.1 * L
    couponMult: { base: 3000, mult: 1.7, perLevel: 0.1 },
    // vault_capacity(L) = baseVaultCapacity + 1500 * L (coins/day).
    // base/mult = geometric price of the branch (the matching coin sink).
    // Curve is tuned in-DB without redeploy; starting values per spec/app/08 §4.
    vault: { base: 8000, mult: 1.8, perLevel: 1500 },
  },

  // Coupon game (spec/app/04, 06, 11). Cost == baseMaxEnergy: one round drains
  // the whole bar, which refills in exactly one hour (spec/app/05).
  couponSessionCost: 500,
  couponSessionDurationMs: 30_000,
  couponFinishGraceMs: 5_000,
  couponCoinPerPoint: 1,
  couponMaxCoins: 3000,
  // Deterministic ceiling: couponMaxCoins (3000) over a 30s round -> 100 pts/s.
  couponMaxPointsPerSec: 100,
  couponRateLimitWindowMs: 10_000,
  couponRateLimitMax: 5,

  // Coupon boost consumable (spec/app/06 §"Буст"). Price ≈ one round's typical
  // payout (~70–100 coins), NOT the couponMaxCoins anti-fraud cap. The grant
  // equals couponSessionCost so it tops a drained bar back to one playable round.
  couponBoostPrice: 100,
  couponBoostEnergyGrant: 500,

  // Daily bonus (spec/app/07): day 1..7+ (reward table /50 vs прежних значений).
  dailyRewards: [10, 15, 20, 30, 40, 60, 100],

  // Staking (spec/app/08) — offline yield engine. flex is liquid; lock trades a
  // term for a higher rate (fills the same daily cap with ~3× less principal).
  // Rates lowered (flex 2%→1%, lock 6%→3%): more principal now feeds the same
  // daily cap; boosts (below) are the way to push a position's yield back up.
  staking: {
    flex: { rateDaily: 0.01, minStake: 5000, termDays: 0, earlyPenalty: 0 },
    lock: { rateDaily: 0.03, minStake: 10000, termDays: 14, earlyPenalty: 0.1 },
  },
  // Per-position boosts shop (spec/app/08 §5). Bought for coins, bound to the
  // active position, gone on unstake. price(L->L+1)=round(base*mult^L).
  //   rate     ⚡ +20%/lvl to the position's daily yield rate (×1.2,×1.4,…).
  //   capacity 🗄 +50%/lvl to the storage cap (×1.5,×2.0,…).
  //   unfreeze 🔓 −50%/lvl of the early-exit penalty (lvl 2 → no penalty).
  stakingBoosts: {
    rate: { base: 5000, mult: 1.8, perLevel: 0.2, maxLevel: 5 },
    capacity: { base: 4000, mult: 1.8, perLevel: 0.5, maxLevel: 5 },
    unfreeze: { base: 6000, mult: 2.2, perLevel: 0.5, maxLevel: 2 },
  },

  // Referral (spec/app/09, 11)
  referralJoinBonusReferrer: 5000,
  referralJoinBonusReferee: 2000,
  referralPremiumBonusReferrer: 25000,
  referralPremiumBonusReferee: 2000,
  referralPassiveRate: 0.1,
  referralPassiveCap: 1_000_000,
  referralMinActivityTaps: 100,
  referralDailyCap: 50,
  referralTotalCap: 500,

  // Auth (spec/app/11)
  authDateMaxAgeMs: 24 * 60 * 60 * 1000,
  jwtTtlSec: 3600,
  authRateLimitWindowMs: 60_000,
  authRateLimitMax: 600,
});
