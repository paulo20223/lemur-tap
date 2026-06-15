/** Coupon game DTOs. coupon.start, coupon.finish (spec/app/06). */

import * as z from 'zod';

export const CouponStartResponseSchema = z.object({
  sessionId: z.string(),
  /** Server seed for the deterministic client-side coupon spawn schedule. */
  seed: z.number(),
});

export const CouponFinishRequestSchema = z.object({
  sessionId: z.string(),
  /** Self-reported round score; integer >= 0. */
  score: z.number().int().min(0),
});

export const CouponFinishResponseSchema = z.object({
  /** Coins awarded for the round (0 if rejected). */
  reward: z.number(),
  /** New coin balance. */
  coins: z.number(),
});

/** coupon.boost — buy the one-shot boost: refills energy for one attempt. */
export const CouponBoostResponseSchema = z.object({
  /** New coin balance after paying the boost price. */
  coins: z.number(),
  /** Energy after the grant (recomputed + topped up). */
  energy: z.number(),
  /** Epoch-ms timestamp the returned energy snapshot corresponds to. */
  energyUpdatedAt: z.number(),
});

export type CouponStartResponse = z.infer<typeof CouponStartResponseSchema>;
export type CouponFinishRequest = z.infer<typeof CouponFinishRequestSchema>;
export type CouponFinishResponse = z.infer<typeof CouponFinishResponseSchema>;
export type CouponBoostResponse = z.infer<typeof CouponBoostResponseSchema>;
