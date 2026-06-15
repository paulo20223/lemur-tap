/**
 * Basket-tier presentation for the "Корзины" shop section (spec/app/13).
 *
 * The economy (tier, durationBonusMs, prices) is server-driven via shop.catalog;
 * this file owns only the *look*: each tier's display name, its metal theme
 * (reusing BASKET_PALETTES — the same colours the in-game basket recolours to),
 * and a preview size so the hierarchy reads visually — higher tiers are bigger.
 */

import type { MessageKey } from '../../i18n';
import { basketPalette, type BasketPalette } from '../CouponGame/lemur';

export { BASKET_SVG } from '../CouponGame/lemur';

export interface BasketVariant {
  /** i18n key for the tier's display name (Обычная / Серебряная / Золотая). */
  nameKey: MessageKey;
  /** Metal theme + colours, shared with the in-game basket. */
  palette: BasketPalette;
  /** Woven-basket width in px — grows with the tier ("больше по размеру"). */
  previewSize: number;
}

const NAME_KEYS: Record<number, MessageKey> = {
  0: 'shop.basketKraft',
  1: 'shop.basketCanvas',
  2: 'shop.basketLeather',
  3: 'shop.basketBronze',
  4: 'shop.basketSilver',
  5: 'shop.basketGold',
};

/** Woven-basket width (px) per tier — the basket visibly grows as it climbs. */
const PREVIEW_SIZE: Record<number, number> = {
  0: 36,
  1: 40,
  2: 44,
  3: 48,
  4: 52,
  5: 56,
};

/** Top tier with display metadata — the clamp target for unknown/future tiers. */
const TOP_TIER = 5;

/** Resolve a basket tier to its display variant (clamped for unknown tiers). */
export function basketVariant(tier: number): BasketVariant {
  return {
    nameKey: NAME_KEYS[tier] ?? NAME_KEYS[TOP_TIER]!,
    palette: basketPalette(tier),
    previewSize: PREVIEW_SIZE[tier] ?? PREVIEW_SIZE[TOP_TIER]!,
  };
}
