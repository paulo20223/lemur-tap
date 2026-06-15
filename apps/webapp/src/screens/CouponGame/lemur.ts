/**
 * The ring-tailed lemur mascot — the single source of truth for how the catcher
 * looks, shared by the in-game scene (scene2d.ts) and the Shop previews
 * (Лемустеры skins / Корзины baskets). Keeping ONE SVG here means a skin preview
 * in the shop shows EXACTLY the lemur you'll play with.
 *
 * The SVG is themable purely through CSS custom properties (set on any ancestor):
 *   --lemur-fur / --lemur-ear / --lemur-eye   → the equipped skin recolours the lemur
 *   --basket-fill / --basket-dark             → the active basket tier recolours the woven basket
 * Every property has a fallback baked into the SVG, so an un-themed render shows
 * the default classic look. Purely cosmetic — no economy here.
 */

/** Ring-tailed lemur cradling a woven shopping basket (original cartoon SVG). */
export const LEMUR_SVG = `
<svg viewBox="0 0 160 150" width="100%" height="100%" aria-hidden="true">
  <!-- ringed tail, curling up the right side -->
  <path d="M120 120 C155 110 156 60 138 40 C128 28 110 26 104 36"
        fill="none" stroke="#f4f1ee" stroke-width="13" stroke-linecap="round"/>
  <path d="M120 120 C155 110 156 60 138 40 C128 28 110 26 104 36"
        fill="none" stroke="#2b2b2b" stroke-width="13" stroke-linecap="round"
        stroke-dasharray="9 11"/>
  <!-- body -->
  <ellipse cx="80" cy="104" rx="34" ry="30" fill="var(--lemur-fur,#9aa0a6)"/>
  <ellipse cx="80" cy="108" rx="22" ry="22" fill="#e9e6e2"/>
  <!-- arms hugging the basket -->
  <path d="M52 100 q-12 14 4 26" fill="none" stroke="var(--lemur-fur,#9aa0a6)" stroke-width="13" stroke-linecap="round"/>
  <path d="M108 100 q12 14 -4 26" fill="none" stroke="var(--lemur-fur,#9aa0a6)" stroke-width="13" stroke-linecap="round"/>
  <!-- head -->
  <circle cx="80" cy="58" r="30" fill="var(--lemur-fur,#9aa0a6)"/>
  <!-- ears -->
  <circle cx="54" cy="34" r="11" fill="var(--lemur-fur,#9aa0a6)"/>
  <circle cx="106" cy="34" r="11" fill="var(--lemur-fur,#9aa0a6)"/>
  <circle cx="54" cy="34" r="5" fill="var(--lemur-ear,#d98c98)"/>
  <circle cx="106" cy="34" r="5" fill="var(--lemur-ear,#d98c98)"/>
  <!-- white face -->
  <path d="M80 30 C100 30 102 54 96 66 C92 76 86 82 80 82 C74 82 68 76 64 66 C58 54 60 30 80 30 Z" fill="#f4f1ee"/>
  <!-- dark eye patches -->
  <ellipse cx="69" cy="56" rx="10" ry="12" fill="#3a3633"/>
  <ellipse cx="91" cy="56" rx="10" ry="12" fill="#3a3633"/>
  <!-- amber eyes -->
  <circle cx="69" cy="57" r="6.5" fill="var(--lemur-eye,#e8a33d)"/>
  <circle cx="91" cy="57" r="6.5" fill="var(--lemur-eye,#e8a33d)"/>
  <circle cx="69" cy="57" r="3" fill="#1a1a1a"/>
  <circle cx="91" cy="57" r="3" fill="#1a1a1a"/>
  <circle cx="71" cy="55" r="1.2" fill="#fff"/>
  <circle cx="93" cy="55" r="1.2" fill="#fff"/>
  <!-- muzzle + nose -->
  <ellipse cx="80" cy="72" rx="8" ry="6" fill="#fbf9f7"/>
  <path d="M76 70 h8 l-4 5 Z" fill="#2b2b2b"/>
  <!-- woven shopping basket (the catch zone), drawn in front -->
  <path d="M46 110 H114 L106 142 H54 Z" fill="var(--basket-fill,#c07b34)"/>
  <path d="M46 110 H114 L112 118 H48 Z" fill="var(--basket-dark,#9a5f24)"/>
  <g stroke="var(--basket-dark,#9a5f24)" stroke-width="2" opacity="0.7">
    <line x1="62" y1="118" x2="60" y2="140"/>
    <line x1="80" y1="118" x2="80" y2="140"/>
    <line x1="98" y1="118" x2="100" y2="140"/>
    <line x1="50" y1="126" x2="110" y2="126"/>
    <line x1="52" y1="134" x2="108" y2="134"/>
  </g>
  <path d="M44 110 q36 -22 72 0" fill="none" stroke="var(--basket-dark,#9a5f24)" stroke-width="5" stroke-linecap="round"/>
</svg>`;

// ── Skins (Лемустеры) ───────────────────────────────────────────────────────

export const DEFAULT_SKIN_ID = 'classic';

/** Visual recipe for a single skin: how it recolours the lemur + its shop chrome. */
export interface LemurPalette {
  /** Fur colour (body, head, ears, arms). */
  fur: string;
  /** Inner-ear tone. */
  ear: string;
  /** Iris colour. */
  eye: string;
  /** Accent used for the shop preview disc / contact glow. */
  accent: string;
  /** Soft secondary tone for the preview disc gradient. */
  glow: string;
  /** Compact emoji marker (accessibility / ultra-small fallbacks). */
  glyph: string;
}

/**
 * Every known skin id → its recolour recipe. Unknown ids fall back to classic.
 *
 * The set is a cast of money-mogul characters (the lemur as a wheeler-dealer):
 * Купец → Делец → Воротила → Магнат → Олигарх → Меценат. Personas, not job
 * titles. Palettes are warm/premium and clearly distinct in hue; the only gold
 * is the top tier and it's soft, never casino.
 */
export const LEMUR_PALETTES: Record<string, LemurPalette> = {
  // Купец — the free default: classic merchant, warm terracotta.
  classic: { fur: '#c2724e', ear: '#f0c2a4', eye: '#5a2f1a', accent: '#c66a40', glow: '#f3c4a0', glyph: '🛍️' },
  // Делец — sly dealmaker, rusty amber.
  dealer: { fur: '#d18a3f', ear: '#f3d49c', eye: '#5e3f14', accent: '#d9912f', glow: '#f6d99a', glyph: '🤝' },
  // Воротила — big operator, gunmetal steel.
  broker: { fur: '#6e7783', ear: '#cdd4dc', eye: '#2b3138', accent: '#5f6874', glow: '#d2d8de', glyph: '💼' },
  // Магнат — industrial tycoon, money emerald.
  magnate: { fur: '#3f8f63', ear: '#b6e0c6', eye: '#1d4632', accent: '#2f9c5a', glow: '#ace6c4', glyph: '🎩' },
  // Олигарх — imperial reach, royal burgundy.
  oligarch: { fur: '#9c4458', ear: '#ecbcc8', eye: '#3e1620', accent: '#b23f56', glow: '#f0b4c2', glyph: '🥂' },
  // Меценат — refined wealth, soft gold.
  patron: { fur: '#d9b24a', ear: '#f6e6b0', eye: '#6e521a', accent: '#d9a92e', glow: '#f6e2a0', glyph: '👑' },
};

/** Resolve a (possibly null/unknown) skin id to its palette. */
export function lemurPalette(skinId: string | null | undefined): LemurPalette {
  if (skinId && LEMUR_PALETTES[skinId]) return LEMUR_PALETTES[skinId]!;
  return LEMUR_PALETTES[DEFAULT_SKIN_ID]!;
}

/** CSS custom properties that recolour the lemur SVG for the given skin. */
export function lemurSkinVars(skinId: string | null | undefined): Record<string, string> {
  const p = lemurPalette(skinId);
  return { '--lemur-fur': p.fur, '--lemur-ear': p.ear, '--lemur-eye': p.eye };
}

// ── Baskets (Корзины) ───────────────────────────────────────────────────────

/**
 * The woven basket on its own — the EXACT geometry the lemur cradles in-game
 * (the same paths as LEMUR_SVG's basket), lifted out so a shop card can show the
 * real catcher rather than a stand-in icon. Recoloured purely through
 * --basket-fill / --basket-dark, so a tier preview renders the basket you'll
 * actually play with. The viewBox is cropped tight to the basket + its handle.
 */
export const BASKET_SVG = `
<svg viewBox="40 93 80 53" width="100%" height="100%" aria-hidden="true">
  <path d="M46 110 H114 L106 142 H54 Z" fill="var(--basket-fill,#c07b34)"/>
  <path d="M46 110 H114 L112 118 H48 Z" fill="var(--basket-dark,#9a5f24)"/>
  <g stroke="var(--basket-dark,#9a5f24)" stroke-width="2" opacity="0.7">
    <line x1="62" y1="118" x2="60" y2="140"/>
    <line x1="80" y1="118" x2="80" y2="140"/>
    <line x1="98" y1="118" x2="100" y2="140"/>
    <line x1="50" y1="126" x2="110" y2="126"/>
    <line x1="52" y1="134" x2="108" y2="134"/>
  </g>
  <path d="M44 110 q36 -22 72 0" fill="none" stroke="var(--basket-dark,#9a5f24)" stroke-width="5" stroke-linecap="round"/>
</svg>`;

/** Coarse material label keyed by basket tier, used for shop-card theming. */
export type BasketMaterial =
  | 'kraft'
  | 'canvas'
  | 'leather'
  | 'bronze'
  | 'silver'
  | 'gold';

/** Material theme keyed by basket tier. tier 0 = default starter basket (kraft). */
export interface BasketPalette {
  /** Front-panel fill of the woven basket. */
  fill: string;
  /** Rim / weave / handle stroke. */
  dark: string;
  /** Coarse material label used for shop-card theming. */
  material: BasketMaterial;
}

/**
 * Tier → material. A carrier ladder mirroring the skin persona ladder (Купец →
 * Меценат): tier 0 «Картонная» is the free kraft basket everyone ships with;
 * paid tiers climb from scrappy hand-made stuff (canvas / leather) into the
 * precious metals of success (bronze / silver / gold). Higher (future) tiers
 * reuse the richest treatment.
 */
export const BASKET_PALETTES: Record<number, BasketPalette> = {
  0: { fill: '#c89a5e', dark: '#9c7038', material: 'kraft' },
  1: { fill: '#cbb489', dark: '#97824f', material: 'canvas' },
  2: { fill: '#b06a3a', dark: '#7a4320', material: 'leather' },
  3: { fill: '#c0823f', dark: '#8c5a22', material: 'bronze' },
  4: { fill: '#cfd4dc', dark: '#8c93a0', material: 'silver' },
  5: { fill: '#ecbb3e', dark: '#b9871d', material: 'gold' },
};

/** Highest tier with a defined palette (richest treatment, used as the clamp). */
const MAX_BASKET_TIER = 5;

/** Resolve a basket tier to its material palette (clamped to the richest known). */
export function basketPalette(tier: number): BasketPalette {
  if (BASKET_PALETTES[tier]) return BASKET_PALETTES[tier]!;
  if (tier <= 0) return BASKET_PALETTES[0]!;
  return BASKET_PALETTES[MAX_BASKET_TIER]!;
}

/** CSS custom properties that recolour the in-game basket for the active tier. */
export function basketTierVars(tier: number): Record<string, string> {
  const p = basketPalette(tier);
  return { '--basket-fill': p.fill, '--basket-dark': p.dark };
}
