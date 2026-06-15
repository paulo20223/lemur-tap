import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  earlyUnstakeReturn,
  effectiveStakeCapacity,
  effectiveStakePenalty,
  effectiveStakeRate,
  effectiveVaultCapacity,
  stakeAccrual,
  stakeBoostPrice,
} from '@lemur/shared';

/**
 * Pure-function coverage for the staking offline yield engine (spec/app/08).
 * These are the client/server-identical economics behind storage accrual, the
 * vault cap and the early-exit penalty. Service-level idempotency (Redis lock +
 * conditional UPDATE) is exercised against the DB, not here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe('stakeAccrual — storage with capacity cap', () => {
  it('fills exactly to the daily cap over a day at the flex break-even principal', () => {
    // 150k @ 2%/day -> 3000/day == capacity (spec/app/08 §4 worked example).
    expect(stakeAccrual(150_000, 0.02, DAY_MS, 0, 3000)).toBe(3000);
  });

  it('lock reaches the same cap with ~3x less principal', () => {
    // 50k @ 6%/day -> 3000/day == capacity.
    expect(stakeAccrual(50_000, 0.06, DAY_MS, 0, 3000)).toBe(3000);
  });

  it('accrues linearly below the cap (half a day -> half the daily yield)', () => {
    expect(stakeAccrual(150_000, 0.02, DAY_MS / 2, 0, 3000)).toBe(1500);
  });

  it('folds newly earned yield into the already-stored amount', () => {
    // 1000 banked + 1500 earned this window = 2500 (still under the 3000 cap).
    expect(stakeAccrual(150_000, 0.02, DAY_MS / 2, 1000, 3000)).toBe(2500);
  });

  it('soft-stops at the cap — a full bar never overflows', () => {
    // Already full; more time elapses; storage stays pinned at capacity.
    expect(stakeAccrual(150_000, 0.02, 10 * DAY_MS, 3000, 3000)).toBe(3000);
  });

  it('caps the yield regardless of how large the principal is', () => {
    // Whale principal would earn far past the cap in a day; it is clamped.
    expect(stakeAccrual(10_000_000, 0.02, DAY_MS, 0, 3000)).toBe(3000);
  });

  it('floors to whole coins', () => {
    // 5000 @ 2%/day over a day = 100; a sub-day slice floors down.
    expect(stakeAccrual(5000, 0.02, DAY_MS, 0, 1_000_000)).toBe(100);
    expect(stakeAccrual(5000, 0.02, DAY_MS / 3, 0, 1_000_000)).toBe(33);
  });

  it('returns the (capped) stored amount when nothing accrues', () => {
    expect(stakeAccrual(150_000, 0.02, 0, 1234, 3000)).toBe(1234);
    expect(stakeAccrual(0, 0.02, DAY_MS, 1234, 3000)).toBe(1234);
    expect(stakeAccrual(150_000, 0, DAY_MS, 1234, 3000)).toBe(1234);
    // A negative elapsed (clock skew) does not lose stored value, but still caps.
    expect(stakeAccrual(150_000, 0.02, -5000, 9999, 3000)).toBe(3000);
  });
});

describe('effectiveVaultCapacity', () => {
  it('equals the base capacity at level 0', () => {
    expect(effectiveVaultCapacity(0, DEFAULT_GAME_CONFIG)).toBe(
      DEFAULT_GAME_CONFIG.baseVaultCapacity,
    );
  });

  it('grows linearly by the vault branch perLevel', () => {
    const { baseVaultCapacity, upgrades } = DEFAULT_GAME_CONFIG;
    expect(effectiveVaultCapacity(5, DEFAULT_GAME_CONFIG)).toBe(
      baseVaultCapacity + upgrades.vault.perLevel * 5,
    );
  });
});

describe('staking boosts (spec/app/08 §5)', () => {
  const cfg = DEFAULT_GAME_CONFIG;

  it('prices boost levels geometrically, base at level 0', () => {
    const { base, mult } = cfg.stakingBoosts.rate;
    expect(stakeBoostPrice('rate', 0, cfg)).toBe(base);
    expect(stakeBoostPrice('rate', 1, cfg)).toBe(Math.round(base * mult));
    expect(stakeBoostPrice('rate', 2, cfg)).toBe(
      Math.round(base * mult * mult),
    );
  });

  it('rate boost multiplies the daily rate by (1 + perLevel·level)', () => {
    const per = cfg.stakingBoosts.rate.perLevel; // 0.2
    expect(effectiveStakeRate(0.01, 0, cfg)).toBeCloseTo(0.01, 10);
    expect(effectiveStakeRate(0.01, 2, cfg)).toBeCloseTo(0.01 * (1 + per * 2), 10);
    // At max level (5) the flex rate returns to ~2x its lowered base.
    expect(effectiveStakeRate(0.03, 5, cfg)).toBeCloseTo(0.06, 10);
  });

  it('capacity boost multiplies the cap by (1 + perLevel·level), floored', () => {
    const per = cfg.stakingBoosts.capacity.perLevel; // 0.5
    expect(effectiveStakeCapacity(3000, 0, cfg)).toBe(3000);
    expect(effectiveStakeCapacity(3000, 2, cfg)).toBe(
      Math.floor(3000 * (1 + per * 2)),
    );
  });

  it('unfreeze boost reduces the penalty, fully waiving it at level 2', () => {
    expect(effectiveStakePenalty(0.1, 0, cfg)).toBeCloseTo(0.1, 10);
    expect(effectiveStakePenalty(0.1, 1, cfg)).toBeCloseTo(0.05, 10); // −50%
    expect(effectiveStakePenalty(0.1, 2, cfg)).toBe(0); // −100% → no penalty
    // Cannot go negative even if over-leveled.
    expect(effectiveStakePenalty(0.1, 9, cfg)).toBe(0);
  });
});

describe('earlyUnstakeReturn — principal minus penalty (a coin sink)', () => {
  it('returns the full principal at zero penalty', () => {
    expect(earlyUnstakeReturn(10_000, 0)).toBe(10_000);
  });

  it('applies the tier penalty fraction and floors', () => {
    expect(earlyUnstakeReturn(10_000, 0.1)).toBe(9000);
    expect(earlyUnstakeReturn(9999, 0.1)).toBe(8999); // floor(8999.1)
  });

  it('clamps penalty into [0,1]', () => {
    expect(earlyUnstakeReturn(10_000, 1)).toBe(0);
    expect(earlyUnstakeReturn(10_000, 2)).toBe(0);
    expect(earlyUnstakeReturn(10_000, -1)).toBe(10_000);
  });
});
