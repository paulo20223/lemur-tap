/**
 * Pure economy functions shared by client and server.
 *
 * These MUST produce identical math on both sides (the client uses them for
 * optimistic UI; the server is authoritative). All money is whole coins and
 * every reward/interest computation floors to a whole coin.
 *
 * Sources: spec/app/04 (economy), 05 (energy), 06 (coupon), 08 (staking),
 * 11 (anti-cheat).
 */

import type { GameConfig } from './config.js';
import type { StakingBoost, UpgradeType } from './enums.js';

// ── Upgrades: price & effective stats (spec/app/04) ────────────────────────

/**
 * Price to go from level `level` to `level + 1`.
 * price(L -> L+1) = round(base * mult^L). First purchase (0->1) costs base.
 * Rounding is applied per level identically on client and server.
 */
export function upgradePrice(
  type: UpgradeType,
  level: number,
  cfg: GameConfig,
): number {
  const branch = cfg.upgrades[type];
  return Math.round(branch.base * Math.pow(branch.mult, level));
}

/**
 * Cumulative cost to OWN level `level`:
 * cum(L) = Σ round(base * mult^i), i = 0..L-1 (spec/app/12 §4).
 */
export function cumulativeUpgradeCost(
  type: UpgradeType,
  level: number,
  cfg: GameConfig,
): number {
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += upgradePrice(type, i, cfg);
  }
  return total;
}

/** max_energy(L) = baseMaxEnergy + perLevel * L. */
export function effectiveMaxEnergy(level: number, cfg: GameConfig): number {
  return cfg.baseMaxEnergy + cfg.upgrades.maxEnergy.perLevel * level;
}

/** energy_regen(L) = energyRegen + perLevel * L energy/sec. */
export function effectiveEnergyRegen(level: number, cfg: GameConfig): number {
  return cfg.energyRegen + cfg.upgrades.energyRegen.perLevel * level;
}

/** coupon_mult(L) = baseCouponMult + perLevel * L (0.1 per level). */
export function effectiveCouponMult(level: number, cfg: GameConfig): number {
  return cfg.baseCouponMult + cfg.upgrades.couponMult.perLevel * level;
}

/**
 * vault_capacity(L) = baseVaultCapacity + perLevel * L coins/day.
 * This is the staking storage cap — the daily ceiling of offline yield a user
 * can bank before claiming. Grows via the VAULT upgrade branch (spec/app/08).
 */
export function effectiveVaultCapacity(level: number, cfg: GameConfig): number {
  return cfg.baseVaultCapacity + cfg.upgrades.vault.perLevel * level;
}

// ── Energy: lazy regen (spec/app/05) ───────────────────────────────────────

export interface EnergyState {
  /** Stored energy at the last recompute (whole units). */
  stored: number;
  /** Epoch-ms timestamp of the last recompute. */
  energyUpdatedAt: number;
}

/**
 * Lazily regenerate energy from a stored snapshot.
 *
 * Critically, `energyUpdatedAt` is advanced only by the time actually credited
 * (in whole energy units), NOT set to `now` — otherwise the sub-unit remainder
 * (< 1/regen of a second) would be lost across frequent recomputes. When the
 * bar is full, the timestamp jumps to `now` (no remainder accumulates).
 *
 * @param state       current {stored, energyUpdatedAt}
 * @param now         current epoch-ms
 * @param regenPerSec per-user energy regen (energy/sec)
 * @param maxEnergy   per-user max energy
 */
export function regenEnergy(
  state: EnergyState,
  now: number,
  regenPerSec: number,
  maxEnergy: number,
): EnergyState {
  const stored = state.stored;
  const energyUpdatedAt = state.energyUpdatedAt;

  // Clock skew / no elapsed time: clamp and return unchanged timestamp.
  if (now <= energyUpdatedAt || regenPerSec <= 0) {
    return {
      stored: Math.min(maxEnergy, Math.max(0, stored)),
      energyUpdatedAt,
    };
  }

  // Already at or above cap: nothing to regen, reset to now (no remainder).
  if (stored >= maxEnergy) {
    return { stored: maxEnergy, energyUpdatedAt: now };
  }

  const elapsedSec = (now - energyUpdatedAt) / 1000;
  const gained = Math.floor(elapsedSec * regenPerSec);

  const current = Math.min(maxEnergy, stored + gained);

  let nextUpdatedAt: number;
  if (current < maxEnergy) {
    // Advance timestamp only by the time that produced whole units;
    // the fractional remainder is preserved for the next recompute.
    nextUpdatedAt = energyUpdatedAt + Math.round((gained / regenPerSec) * 1000);
  } else {
    // Bar full — remainder does not accumulate.
    nextUpdatedAt = now;
  }

  return { stored: current, energyUpdatedAt: nextUpdatedAt };
}

// ── Coupon (spec/app/06) ───────────────────────────────────────────────────

/**
 * Coins awarded for a coupon round:
 * reward = min(couponMaxCoins, floor(score * couponCoinPerPoint * couponMult)).
 */
export function couponReward(
  score: number,
  couponMult: number,
  cfg: GameConfig,
): number {
  const raw = Math.floor(score * cfg.couponCoinPerPoint * couponMult);
  return Math.min(cfg.couponMaxCoins, Math.max(0, raw));
}

/**
 * Effective coupon round duration (ms) given the user's active basket tier.
 * = couponSessionDurationMs + the active tier's durationBonusMs (spec/app/13).
 * The tier is matched by its `tier` field (the catalog now includes the free
 * tier 0 «Картонная», bonus 0). An unknown tier (missing config) contributes 0
 * (graceful fallback). Single source both client and server use to size a round.
 *
 * @param cfg        live game config
 * @param basketTier the user's owned/active basket tier (0 = default)
 */
export function effectiveCouponDurationMs(
  cfg: GameConfig,
  basketTier: number,
): number {
  const bonus =
    cfg.baskets.find((b) => b.tier === basketTier)?.durationBonusMs ?? 0;
  return cfg.couponSessionDurationMs + bonus;
}

/**
 * Deterministic anti-cheat ceiling on an acceptable score.
 * Computed from the server-measured elapsed time, clamped to the round
 * duration. Accepted scores satisfy 0 <= score <= couponMaxScore(...).
 * `seed` reserved for future per-coupon layout verification.
 *
 * @param seed       server seed (reserved; deterministic layout hook)
 * @param elapsedSec actual elapsed seconds, clamped to `durationMs`
 * @param cfg        live game config
 * @param durationMs effective round duration in ms (default = base round
 *                   duration); pass effectiveCouponDurationMs(cfg, basketTier)
 *                   so a basket-extended round clamps to its real length
 */
export function couponMaxScore(
  seed: number,
  elapsedSec: number,
  cfg: GameConfig,
  durationMs: number = cfg.couponSessionDurationMs,
): number {
  void seed;
  const cappedElapsed = Math.min(
    Math.max(0, elapsedSec),
    durationMs / 1000,
  );
  return Math.floor(cappedElapsed * cfg.couponMaxPointsPerSec);
}

// ── Staking (spec/app/08) ──────────────────────────────────────────────────

const STAKE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Staking storage accrual (spec/app/08 §3 — offline yield engine).
 *
 * Yield drips into a storage bucket at `amount * rateDaily` coins/day and stops
 * at `capacity` (soft idle: a full bar simply pauses — nothing is lost or burnt;
 * the forgone overflow is the nudge to come back and claim). This folds the
 * yield earned over `elapsedMs` into the already-stored amount, then clamps to
 * the cap. Linear (NOT compounding): the principal is paid out separately on
 * unstake, only the storage is claimed.
 *
 * @param amount    current principal (coins)
 * @param rateDaily daily yield fraction snapshot for the tier
 * @param elapsedMs ms since the storage was last folded/claimed
 * @param stored    storage already banked (coins), pending claim
 * @param capacity  storage cap = vault capacity (coins)
 * @returns new stored storage, floored to whole coins and capped at capacity
 */
export function stakeAccrual(
  amount: number,
  rateDaily: number,
  elapsedMs: number,
  stored: number,
  capacity: number,
): number {
  const base = Math.max(0, stored);
  if (amount <= 0 || rateDaily <= 0 || elapsedMs <= 0) {
    return Math.min(capacity, base);
  }
  const gained = Math.floor((amount * rateDaily * elapsedMs) / STAKE_DAY_MS);
  return Math.min(capacity, base + gained);
}

/**
 * Principal returned on an early exit of a locked position:
 * floor(amount * (1 - penalty)). The forfeited slice is a coin sink; any
 * unclaimed storage is also forfeited (handled by the caller). Floors to whole
 * coins. See spec/app/08 §3.2.
 */
export function earlyUnstakeReturn(amount: number, penalty: number): number {
  const keep = 1 - Math.min(1, Math.max(0, penalty));
  return Math.floor(Math.max(0, amount) * keep);
}

// ── Staking boosts (spec/app/08 §5) ────────────────────────────────────────

/**
 * Coin price to buy the next level of `boost` (from `level` to `level + 1`):
 * price = round(base * mult^level). Geometric, mirrors upgradePrice(). The
 * first level (0 -> 1) costs `base`. Identical on client and server.
 */
export function stakeBoostPrice(
  boost: StakingBoost,
  level: number,
  cfg: GameConfig,
): number {
  const b = cfg.stakingBoosts[boost];
  return Math.round(b.base * Math.pow(b.mult, level));
}

/**
 * Effective daily yield rate of a position given its `rate` boost level:
 * baseRate * (1 + perLevel * level). The snapshot tier rate is multiplied, not
 * replaced — so an early config change to the tier rate still flows through.
 */
export function effectiveStakeRate(
  baseRate: number,
  rateBoostLevel: number,
  cfg: GameConfig,
): number {
  const mult = 1 + cfg.stakingBoosts.rate.perLevel * Math.max(0, rateBoostLevel);
  return baseRate * mult;
}

/**
 * Effective storage capacity of a position given its `capacity` boost level:
 * floor(vaultCapacity * (1 + perLevel * level)). Floors to whole coins so the
 * cap stays an integer on both sides.
 */
export function effectiveStakeCapacity(
  vaultCapacity: number,
  capacityBoostLevel: number,
  cfg: GameConfig,
): number {
  const mult =
    1 + cfg.stakingBoosts.capacity.perLevel * Math.max(0, capacityBoostLevel);
  return Math.floor(Math.max(0, vaultCapacity) * mult);
}

/**
 * Effective early-exit penalty of a locked position given its `unfreeze` boost
 * level: basePenalty * (1 - perLevel * level), clamped to [0, basePenalty]. At
 * level 2 (perLevel 0.5) the penalty is fully waived.
 */
export function effectiveStakePenalty(
  basePenalty: number,
  unfreezeBoostLevel: number,
  cfg: GameConfig,
): number {
  const reduction =
    cfg.stakingBoosts.unfreeze.perLevel * Math.max(0, unfreezeBoostLevel);
  const keep = Math.max(0, 1 - reduction);
  return Math.max(0, basePenalty) * keep;
}
