/** Leaderboard DTOs. leaderboard.top — ranking by current coin balance. */

import * as z from 'zod';

/** A single ranked player. `rank` is 1-based within the global ordering. */
export const LeaderboardEntrySchema = z.object({
  rank: z.number().int(),
  userId: z.string(),
  username: z.string().nullable(),
  isPremium: z.boolean(),
  /** Current whole-coin balance the ranking is computed from. */
  coins: z.number(),
});

export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
  /** Highest-ranked players, best first (length ≤ requested limit). */
  top: z.array(LeaderboardEntrySchema),
  /**
   * The viewer's own ranked row, always present even when outside `top`, so the
   * client can pin "your position". Null only if the viewer has no rank yet.
   */
  me: LeaderboardEntrySchema.nullable(),
  /** Total number of ranked players. */
  total: z.number().int(),
});

export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const LeaderboardQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;
