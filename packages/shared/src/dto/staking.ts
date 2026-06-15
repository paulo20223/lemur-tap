/** Staking DTOs. GET /staking, POST /staking/{stake,claim,unstake} (spec/app/08, 10). */

import * as z from 'zod';

import { STAKE_STATUSES, STAKING_BOOSTS, STAKING_TIERS } from '../enums.js';

/** Per-position boost levels (spec/app/08 §5). Missing/closed ⇒ all zero. */
export const StakeBoostLevelsSchema = z.object(
  Object.fromEntries(STAKING_BOOSTS.map((b) => [b, z.number()])) as Record<
    (typeof STAKING_BOOSTS)[number],
    z.ZodNumber
  >,
);

export type StakeBoostLevels = z.infer<typeof StakeBoostLevelsSchema>;

export const StakePositionSchema = z.object({
  stakeId: z.string(),
  /** Locked principal (the working capital; unchanged by accrual). */
  amount: z.number(),
  tier: z.enum(STAKING_TIERS),
  /**
   * EFFECTIVE daily yield rate as a decimal string (e.g. "0.012") — already
   * includes the position's `rate` boost. Drives the storage accrual preview.
   */
  rateDaily: z.string(),
  /** Unlock time ISO string, or null for flex. */
  unlockAt: z.string().nullable(),
  /** Yield banked in storage and claimable now (coins). */
  storageAccrued: z.number(),
  /** EFFECTIVE storage cap (vault capacity × `capacity` boost). Bar = accrued/capacity. */
  capacity: z.number(),
  /** Current boost levels bought for this position. */
  boosts: StakeBoostLevelsSchema,
  status: z.enum(STAKE_STATUSES),
});

export type StakePositionDto = z.infer<typeof StakePositionSchema>;

/** GET /staking — active positions with lazily computed storage accrual. */
export const StakingListResponseSchema = z.array(StakePositionSchema);
export type StakingListResponse = z.infer<typeof StakingListResponseSchema>;

export const StakeRequestSchema = z.object({
  /** Coins to lock; integer > 0, >= tier minimum, <= balance. Tops up if open. */
  amount: z.number().int().min(1),
  tier: z.enum(STAKING_TIERS),
});

export type StakeRequest = z.infer<typeof StakeRequestSchema>;

/** POST /staking/stake — the created/topped-up position. */
export const StakeResponseSchema = StakePositionSchema;
export type StakeResponse = z.infer<typeof StakeResponseSchema>;

export const ClaimRequestSchema = z.object({
  stakeId: z.string(),
});

export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

export const ClaimResponseSchema = z.object({
  /** Yield moved from storage to the wallet (coins; 0 if nothing pending). */
  claimed: z.number(),
  /** New coin balance. */
  coins: z.number(),
});

export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const UnstakeRequestSchema = z.object({
  stakeId: z.string(),
  /**
   * Acknowledge the early-exit penalty for a still-locked position. Without it,
   * unstaking a locked position is refused (stake_locked) so the client can
   * confirm. Ignored once the position is unlocked.
   */
  confirmEarly: z.boolean().optional(),
});

export type UnstakeRequest = z.infer<typeof UnstakeRequestSchema>;

export const UnstakeResponseSchema = z.object({
  /** Principal returned to balance (after any early-exit penalty). */
  returned: z.number(),
  /** Yield auto-claimed from storage on unstake (0 on a forfeiting early exit). */
  claimed: z.number(),
  /** Whether an early-exit penalty was applied. */
  penalized: z.boolean(),
  /** New coin balance. */
  coins: z.number(),
});

export type UnstakeResponse = z.infer<typeof UnstakeResponseSchema>;

/** POST /staking/boost — buy one level of a boost for an active position. */
export const BoostRequestSchema = z.object({
  stakeId: z.string(),
  boost: z.enum(STAKING_BOOSTS),
});

export type BoostRequest = z.infer<typeof BoostRequestSchema>;

/** POST /staking/boost — the updated position after the boost is applied. */
export const BoostResponseSchema = StakePositionSchema;
export type BoostResponse = z.infer<typeof BoostResponseSchema>;
