/**
 * Shared DTO building blocks: user profile, ledger views.
 * Money fields are whole coins serialized as `number` on the wire (JS-safe
 * within game ranges); the server stores them as BIGINT.
 */

import * as z from 'zod';

import { LEDGER_TYPES, REF_SOURCES } from '../enums.js';
import type {
  CouponSessionStatus,
  StakeStatus,
  StakingTier,
  UpgradeType,
} from '../enums.js';

/** Public user profile + live balances (energy already recomputed). */
export const UserProfileSchema = z.object({
  id: z.string(),
  telegramId: z.string(),
  username: z.string().nullable(),
  isPremium: z.boolean(),
  coins: z.number(),
  /** Current energy after lazy regen at response time. */
  energy: z.number(),
  /** Per-user max energy (derived from maxEnergy upgrade level). */
  maxEnergy: z.number(),
  /** Per-user energy regen, energy/sec (derived from energyRegen level). */
  energyRegen: z.number(),
  /** Epoch-ms timestamp the energy snapshot corresponds to. */
  energyUpdatedAt: z.number(),
  referralCode: z.string(),
  /** Active basket tier (0 = default; raises the coupon round duration). */
  basketTier: z.number().int(),
  createdAt: z.string(),
});

export type UserProfileDto = z.infer<typeof UserProfileSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string(),
  amount: z.number(),
  type: z.enum(LEDGER_TYPES),
  refSource: z.enum(REF_SOURCES).nullable(),
  refId: z.string().nullable(),
  createdAt: z.string(),
});

export type LedgerEntryDto = z.infer<typeof LedgerEntrySchema>;

/** Re-export enum unions used across DTOs for convenience. */
export type {
  CouponSessionStatus,
  StakeStatus,
  StakingTier,
  UpgradeType,
};
