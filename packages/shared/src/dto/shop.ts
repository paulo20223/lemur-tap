/**
 * Shop DTOs (spec/app/13). shop.catalog, shop.buyBasket, shop.buySkin,
 * shop.equipSkin. Each item carries both prices (coins now; Stars phase 4).
 * Money fields are whole coins serialized as `number` on the wire.
 */

import * as z from 'zod';

/** Currency a purchase is paid in. 'stars' is reserved (phase 4). */
export const ShopCurrencySchema = z.enum(['coins', 'stars']);
export type ShopCurrency = z.infer<typeof ShopCurrencySchema>;

/** A basket tier in the catalog, enriched with the user's ownership state. */
export const ShopBasketItemSchema = z.object({
  tier: z.number().int(),
  /** Ms added to the coupon round while this tier is active. */
  durationBonusMs: z.number().int(),
  priceCoins: z.number().int(),
  priceStars: z.number().int(),
  /** Whether the user owns this tier (owning a tier implies owning all below it). */
  owned: z.boolean(),
  /** Whether this tier is the active one (the best owned tier). */
  active: z.boolean(),
});
export type ShopBasketItem = z.infer<typeof ShopBasketItemSchema>;

/** A cosmetic skin in the catalog, enriched with the user's ownership state. */
export const ShopSkinItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCoins: z.number().int(),
  priceStars: z.number().int(),
  /** Whether the user owns this skin. */
  owned: z.boolean(),
  /** Whether this skin is currently equipped. */
  equipped: z.boolean(),
});
export type ShopSkinItem = z.infer<typeof ShopSkinItemSchema>;

/** shop.catalog — live catalog + the user's ownership/equip state. */
export const ShopCatalogResponseSchema = z.object({
  baskets: z.array(ShopBasketItemSchema),
  skins: z.array(ShopSkinItemSchema),
  /** The user's active basket tier (0 = default). */
  basketTier: z.number().int(),
  /** The user's equipped skin id (null until one is equipped). */
  equippedSkinId: z.string().nullable(),
});
export type ShopCatalogResponse = z.infer<typeof ShopCatalogResponseSchema>;

/** shop.buyBasket — buy a basket tier with the chosen currency. */
export const BuyBasketRequestSchema = z.object({
  tier: z.number().int(),
  currency: ShopCurrencySchema,
});
export type BuyBasketRequest = z.infer<typeof BuyBasketRequestSchema>;

/** shop.buySkin — buy a cosmetic skin with the chosen currency. */
export const BuySkinRequestSchema = z.object({
  skinId: z.string(),
  currency: ShopCurrencySchema,
});
export type BuySkinRequest = z.infer<typeof BuySkinRequestSchema>;

/** shop.equipSkin — equip an owned skin. */
export const EquipSkinRequestSchema = z.object({
  skinId: z.string(),
});
export type EquipSkinRequest = z.infer<typeof EquipSkinRequestSchema>;

/**
 * shop.buyBasket / shop.buySkin / shop.equipSkin response: new coin balance
 * plus the updated state of the touched item. Exactly one of `basket`/`skin`
 * is set (the item type the procedure operated on).
 */
export const ShopPurchaseResponseSchema = z.object({
  /** New coin balance after the operation. */
  coins: z.number(),
  /** Updated basket item state (set by basket operations). */
  basket: ShopBasketItemSchema.nullable(),
  /** Updated skin item state (set by skin operations). */
  skin: ShopSkinItemSchema.nullable(),
});
export type ShopPurchaseResponse = z.infer<typeof ShopPurchaseResponseSchema>;

/**
 * shop.createStarsInvoice — request a Telegram Stars invoice link for a shop
 * item (phase 4). `kind` selects the item type; `ref` is the basket tier as a
 * string (e.g. "1") for kind 'basket', or the skinId for kind 'skin'.
 */
export const StarsInvoiceRequestSchema = z.object({
  kind: z.enum(['basket', 'skin']),
  ref: z.string(),
});
export type StarsInvoiceRequest = z.infer<typeof StarsInvoiceRequestSchema>;

/** shop.createStarsInvoice response: a Telegram invoice link to open client-side. */
export const StarsInvoiceResponseSchema = z.object({
  invoiceLink: z.string(),
});
export type StarsInvoiceResponse = z.infer<typeof StarsInvoiceResponseSchema>;
