/** Upgrade DTOs. GET /upgrades, POST /upgrades/:type/buy (spec/app/04, 10). */

import * as z from 'zod';

import { UPGRADE_TYPES } from '../enums.js';

export const UpgradeStateSchema = z.object({
  type: z.enum(UPGRADE_TYPES),
  /** Current level (0-indexed). */
  level: z.number(),
  /** Price of the next level, or null when maxed. */
  nextPrice: z.number().nullable(),
  /** True when level === MAX_LEVEL. */
  maxed: z.boolean(),
});

export type UpgradeStateDto = z.infer<typeof UpgradeStateSchema>;

/** GET /upgrades — state of every branch. */
export const UpgradesListResponseSchema = z.array(UpgradeStateSchema);
export type UpgradesListResponse = z.infer<typeof UpgradesListResponseSchema>;

/** POST /upgrades/:type/buy — request. */
export const UpgradeBuyRequestSchema = z.object({
  type: z.enum(UPGRADE_TYPES),
});

export const UpgradeBuyResponseSchema = z.object({
  type: z.enum(UPGRADE_TYPES),
  /** Level after purchase. */
  level: z.number(),
  /** Price of the next level after purchase, or null when maxed. */
  nextPrice: z.number().nullable(),
  /** New coin balance. */
  coins: z.number(),
});

export type UpgradeBuyResponse = z.infer<typeof UpgradeBuyResponseSchema>;
