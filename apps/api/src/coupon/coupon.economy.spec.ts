import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  couponMaxScore,
  couponReward,
  effectiveCouponMult,
} from '@lemur/shared';

/**
 * Pure-function coverage for the Coupon Catch economics (spec/app/06, 11).
 * Client/server-identical math: the floored reward, the anti-cheat score ceiling
 * and the per-level multiplier. Service-level anti-cheat / idempotency is
 * exercised against the DB, not here.
 */

const cfg = DEFAULT_GAME_CONFIG;
const SEED = 12345;

describe('couponReward — floored, capped coin reward', () => {
  it('awards nothing for a zero score', () => {
    expect(couponReward(0, 1, cfg)).toBe(0);
  });

  it('floors score * coinPerPoint * mult (1:1 at base mult)', () => {
    // couponCoinPerPoint=1, mult=1 -> reward == score.
    expect(couponReward(250, 1, cfg)).toBe(250);
  });

  it('floors a fractional multiplier', () => {
    // floor(7 * 1 * 1.1) = floor(7.7) = 7.
    expect(couponReward(7, 1.1, cfg)).toBe(7);
  });

  it('clamps to couponMaxCoins when points * mult overshoot', () => {
    expect(couponReward(10_000, 5, cfg)).toBe(cfg.couponMaxCoins);
  });
});

describe('couponMaxScore — anti-cheat ceiling', () => {
  it('equals duration * maxPointsPerSec at a full round', () => {
    // 30s * 100 pts/s = 3000.
    expect(couponMaxScore(SEED, 30, cfg)).toBe(3000);
  });

  it('is zero at zero elapsed', () => {
    expect(couponMaxScore(SEED, 0, cfg)).toBe(0);
  });

  it('clamps elapsed to the round duration', () => {
    expect(couponMaxScore(SEED, 999, cfg)).toBe(3000);
  });

  it('treats negative elapsed (clock skew) as zero', () => {
    expect(couponMaxScore(SEED, -10, cfg)).toBe(0);
  });
});

describe('effectiveCouponMult — per-level multiplier', () => {
  it('equals the base multiplier at level 0', () => {
    expect(effectiveCouponMult(0, cfg)).toBe(cfg.baseCouponMult);
  });

  it('grows linearly by the couponMult branch perLevel (1 + 0.1*L)', () => {
    // base 1 + 0.1 * 10 = 2.
    expect(effectiveCouponMult(10, cfg)).toBeCloseTo(2, 10);
  });
});
