/** Daily bonus DTOs. GET /daily, POST /daily/claim (spec/app/07, 10). */

import * as z from 'zod';

export const DailyStatusResponseSchema = z.object({
  /** Actual streak length (uncapped). */
  streak: z.number(),
  /** day = min(streak, 7); index into the reward table. */
  currentDay: z.number(),
  alreadyClaimedToday: z.boolean(),
  /** Reward for the current day (claimable now or already claimed). */
  todayReward: z.number(),
  /** Reward the user would get on the next claim day. */
  nextReward: z.number(),
  /** Next UTC midnight as ISO string. */
  nextClaimAtUtc: z.string(),
});

export const DailyClaimResponseSchema = z.object({
  /** Coins granted by this claim. */
  reward: z.number(),
  /** New coin balance. */
  coins: z.number(),
  /** Streak after this claim. */
  streak: z.number(),
});

export type DailyStatusResponse = z.infer<typeof DailyStatusResponseSchema>;
export type DailyClaimResponse = z.infer<typeof DailyClaimResponseSchema>;
