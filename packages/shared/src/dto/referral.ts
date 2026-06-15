/** Referral DTOs. GET /referral (spec/app/09, 10). */

import * as z from 'zod';

export const ReferralEarningsSchema = z.object({
  /** Aggregate one-off join bonuses earned. */
  join: z.number(),
  /** Aggregate one-off premium bonuses earned. */
  premium: z.number(),
  /** Aggregate passive income minted from referees. */
  passive: z.number(),
  /** join + premium + passive. */
  total: z.number(),
});

export type ReferralEarningsDto = z.infer<typeof ReferralEarningsSchema>;

export const ReferralItemSchema = z.object({
  /** Referee user id. */
  userId: z.string(),
  username: z.string().nullable(),
  isPremium: z.boolean(),
  joinedAt: z.string(),
});

export type ReferralItemDto = z.infer<typeof ReferralItemSchema>;

export const ReferralResponseSchema = z.object({
  code: z.string(),
  /** Telegram deep link, e.g. https://t.me/<bot>/<app>?startapp=ref_<code>. */
  link: z.string(),
  earnings: ReferralEarningsSchema,
  referrals: z.array(ReferralItemSchema),
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: z.string().nullable(),
});

export type ReferralResponse = z.infer<typeof ReferralResponseSchema>;

export const ReferralQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().optional(),
});

export type ReferralQuery = z.infer<typeof ReferralQuerySchema>;
