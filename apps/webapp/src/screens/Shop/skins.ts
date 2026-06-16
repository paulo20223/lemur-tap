/**
 * Cosmetic skin presentation — the *visual* mapping for the "Lemusters" skins
 * (spec/app/13). The catalog (ids, names, prices, ownership) is server-driven;
 * this file owns only how a given skin id looks on the client until the final
 * art lands. Pure cosmetics — no economy here.
 *
 * The actual recolour recipe lives in CouponGame/lemur.ts (the single source the
 * in-game catcher uses), so a shop preview renders the EXACT lemur you'll play
 * with. Unknown ids (older clients, future skins) fall back to 'classic'.
 */

import type { MessageKey } from '../../i18n';
import { LEMUR_PALETTES, DEFAULT_SKIN_ID, lemurPalette } from '../CouponGame/lemur';

export { DEFAULT_SKIN_ID, lemurSkinVars, LEMUR_SVG } from '../CouponGame/lemur';

/**
 * i18n key for a skin's display name, keyed by skin id. The server catalog also
 * ships a `name`, but it's Russian-only; localizing here mirrors how baskets
 * resolve their tier names (baskets.ts). Unknown ids (older clients, future
 * skins) have no key — callers fall back to the server-provided `name`.
 */
const SKIN_NAME_KEYS: Record<string, MessageKey> = {
  classic: 'shop.skinClassic',
  dealer: 'shop.skinDealer',
  broker: 'shop.skinBroker',
  magnate: 'shop.skinMagnate',
  oligarch: 'shop.skinOligarch',
  patron: 'shop.skinPatron',
};

/** i18n key for a skin id's name, or null if the id is unknown (use server name). */
export function skinNameKey(skinId: string | null | undefined): MessageKey | null {
  return (skinId ? SKIN_NAME_KEYS[skinId] : null) ?? null;
}

export interface SkinVariant {
  /** Accent color used to tint the preview/mascot for this skin. */
  accent: string;
  /** Soft secondary tone for gradients/halos. */
  glow: string;
  /** A short emoji glyph used as a quick visual marker in compact previews. */
  glyph: string;
}

/** Resolve a skin id (possibly null/unknown) to its visual variant. */
export function skinVariant(skinId: string | null | undefined): SkinVariant {
  const p = lemurPalette(skinId);
  return { accent: p.accent, glow: p.glow, glyph: p.glyph };
}

/** Stable skin id with the default fallback applied. */
export function resolveSkinId(skinId: string | null | undefined): string {
  return skinId && LEMUR_PALETTES[skinId] ? skinId : DEFAULT_SKIN_ID;
}
