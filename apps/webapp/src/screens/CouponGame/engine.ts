/**
 * Deterministic coupon-game engine helpers (spec/app/06, §G.4).
 *
 * The server hands the client a numeric `seed` (CouponStartResponse.seed) and
 * the round layout is derived deterministically from it. The server's anti-cheat
 * bound (couponMaxScore) caps points at `couponMaxPointsPerSec * elapsedSec`, so
 * we tune the spawn schedule to stay comfortably under that ceiling (~70%) for a
 * clean, fully-caught run. Spawns stop ~1.2s before the end so the last coupon
 * can still be caught in time.
 *
 * All gameplay (movement, catching) runs on the client; only the seed-driven
 * spawn schedule needs to be deterministic.
 */
import { type Brand, pickBrand } from './coupons';

/** Mulberry32 — small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpawnSpec {
  /** Spawn time from round start, in seconds. */
  t: number;
  /** Horizontal spawn position, normalized 0..1. */
  x: number;
  /** Fall speed, normalized lane-heights per second. */
  vy: number;
  brand: Brand;
}

/**
 * Build the full deterministic spawn schedule for a round.
 *
 * Spacing + values are chosen so a skilled "catch everything" run stays under
 * ~70% of the server ceiling (`durationSec * maxPointsPerSec`), leaving margin
 * for misses + rounding so a perfect run never trips the anti-cheat bound.
 *
 * @param seed            server seed
 * @param durationSec     round duration (seconds)
 * @param maxPointsPerSec server anti-cheat points/sec ceiling (from config)
 */
export function buildSpawnSchedule(
  seed: number,
  durationSec: number,
  maxPointsPerSec: number,
): SpawnSpec[] {
  const rand = mulberry32(seed);
  const schedule: SpawnSpec[] = [];

  // Target total catchable points = ~70% of the server ceiling.
  const targetTotal = Math.floor(durationSec * maxPointsPerSec * 0.7);

  // First coupon appears shortly after the round starts.
  let t = 0.5;
  let total = 0;

  // Stop a touch before the end so the last coupon can still be caught.
  const lastSpawnT = durationSec - 1.2;

  while (t < lastSpawnT && total < targetTotal) {
    const brand = pickBrand(rand());
    const x = 0.08 + rand() * 0.84; // keep clear of the very edges
    // Legendaries fall slightly faster (harder to catch).
    const speedBoost = brand.rarity === 'legendary' ? 0.08 : 0;
    const vy = 0.2 + rand() * 0.12 + speedBoost;
    schedule.push({ t, x, vy, brand });
    total += brand.points;

    // Gap between spawns: dense enough to be lively, sparse enough to be fair.
    // Tuned so a full catch-everything round totals ~55–60 points (≈24–25
    // coupons over a 30s round at ~2.47 avg points/coupon).
    const gap = 0.7 + rand() * 0.9;
    t += gap;
  }

  return schedule;
}
