/**
 * oRPC contract — the single source of truth for the RPC surface.
 * Server router and client both derive their shape from this tree.
 * See spec/orpc/IMPLEMENTATION.md (Phase 1).
 */

import { oc } from '@orpc/contract';
import * as z from 'zod';

import { GameConfigSchema } from '../config.js';
import {
  AuthTelegramRequestSchema,
  AuthTelegramResponseSchema,
  BoostRequestSchema,
  BoostResponseSchema,
  BuyBasketRequestSchema,
  BuySkinRequestSchema,
  ClaimRequestSchema,
  ClaimResponseSchema,
  CouponBoostResponseSchema,
  CouponFinishRequestSchema,
  CouponFinishResponseSchema,
  CouponStartResponseSchema,
  DailyClaimResponseSchema,
  DailyStatusResponseSchema,
  EquipSkinRequestSchema,
  LeaderboardQuerySchema,
  LeaderboardResponseSchema,
  ReferralQuerySchema,
  ReferralResponseSchema,
  ShopCatalogResponseSchema,
  ShopPurchaseResponseSchema,
  StarsInvoiceRequestSchema,
  StarsInvoiceResponseSchema,
  StakePositionSchema,
  StakeRequestSchema,
  StakeResponseSchema,
  UnstakeRequestSchema,
  UnstakeResponseSchema,
  UpgradeBuyRequestSchema,
  UpgradeBuyResponseSchema,
  UpgradeStateSchema,
  UserProfileSchema,
} from '../dto/index.js';

export const contract = {
  auth: {
    telegram: oc
      .input(AuthTelegramRequestSchema)
      .output(AuthTelegramResponseSchema),
  },
  users: {
    me: oc.output(UserProfileSchema),
    config: oc.output(GameConfigSchema),
  },
  upgrades: {
    list: oc.output(z.array(UpgradeStateSchema)),
    buy: oc
      .input(UpgradeBuyRequestSchema)
      .output(UpgradeBuyResponseSchema)
      .errors({ INSUFFICIENT_COINS: {}, UNKNOWN_TYPE: {}, MAX_LEVEL: {} }),
  },
  coupon: {
    start: oc
      .output(CouponStartResponseSchema)
      .errors({ SESSION_ACTIVE: {}, INSUFFICIENT_ENERGY: {} }),
    finish: oc
      .input(CouponFinishRequestSchema)
      .output(CouponFinishResponseSchema)
      .errors({ SESSION_NOT_FOUND: {}, SESSION_REJECTED: {}, SESSION_EXPIRED: {} }),
    boost: oc
      .output(CouponBoostResponseSchema)
      .errors({ INSUFFICIENT_COINS: {}, COUPON_BOOST_LIMIT: {} }),
  },
  daily: {
    status: oc.output(DailyStatusResponseSchema),
    claim: oc
      .output(DailyClaimResponseSchema)
      .errors({ DAILY_ALREADY_CLAIMED: {} }),
  },
  staking: {
    list: oc.output(z.array(StakePositionSchema)),
    stake: oc
      .input(StakeRequestSchema)
      .output(StakeResponseSchema)
      .errors({ AMOUNT_BELOW_MIN: {}, UNKNOWN_TIER: {}, INSUFFICIENT_COINS: {} }),
    claim: oc
      .input(ClaimRequestSchema)
      .output(ClaimResponseSchema)
      .errors({ STAKE_NOT_FOUND: {} }),
    unstake: oc
      .input(UnstakeRequestSchema)
      .output(UnstakeResponseSchema)
      .errors({ STAKE_LOCKED: {}, STAKE_NOT_FOUND: {} }),
    boost: oc
      .input(BoostRequestSchema)
      .output(BoostResponseSchema)
      .errors({
        STAKE_NOT_FOUND: {},
        UNKNOWN_BOOST: {},
        INSUFFICIENT_COINS: {},
        MAX_LEVEL: {},
      }),
  },
  shop: {
    catalog: oc.output(ShopCatalogResponseSchema),
    buyBasket: oc
      .input(BuyBasketRequestSchema)
      .output(ShopPurchaseResponseSchema)
      .errors({
        INSUFFICIENT_COINS: {},
        ALREADY_OWNED: {},
        UNKNOWN_ITEM: {},
        STARS_NOT_AVAILABLE: {},
      }),
    buySkin: oc
      .input(BuySkinRequestSchema)
      .output(ShopPurchaseResponseSchema)
      .errors({
        INSUFFICIENT_COINS: {},
        ALREADY_OWNED: {},
        UNKNOWN_ITEM: {},
        STARS_NOT_AVAILABLE: {},
      }),
    equipSkin: oc
      .input(EquipSkinRequestSchema)
      .output(ShopPurchaseResponseSchema)
      .errors({ NOT_OWNED: {}, UNKNOWN_ITEM: {} }),
    createStarsInvoice: oc
      .input(StarsInvoiceRequestSchema)
      .output(StarsInvoiceResponseSchema)
      .errors({ UNKNOWN_ITEM: {}, ALREADY_OWNED: {}, STARS_NOT_AVAILABLE: {} }),
  },
  referral: {
    list: oc.input(ReferralQuerySchema).output(ReferralResponseSchema),
  },
  leaderboard: {
    top: oc.input(LeaderboardQuerySchema).output(LeaderboardResponseSchema),
  },
};
