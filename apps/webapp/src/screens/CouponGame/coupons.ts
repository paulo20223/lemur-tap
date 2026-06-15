/**
 * Coupon brand model — coupon-game (spec/app/06, §"Бренды и редкость").
 *
 * Pure data + a weighted picker. No rendering here: the 2D scene (scene2d.ts)
 * draws each coupon as a card showing the brand's real logo (logos.ts) or, for
 * brands without an available glyph, a coloured wordmark fallback. Rarity drives
 * both spawn weight (rarer = lower weight) and points (rarer = more points).
 */
import { LOGOS, type LogoKey } from './logos';

export type Rarity = 'common' | 'rare' | 'legendary';

export interface Brand {
  /** Brand name — used nominatively as game flavor and for the wordmark fallback. */
  name: string;
  rarity: Rarity;
  /** Points awarded when caught. */
  points: number;
  /** Accent color (hex) — drives card styling. */
  color: string;
  /** Cumulative-weight spawn frequency (rarer brands have lower weight). */
  weight: number;
  /** Key into LOGOS; absent → render a coloured wordmark fallback. */
  logo?: LogoKey;
}

/** 11 brands (spec §"Бренды и редкость"). Pepsi/Rolex have no bundled glyph. */
export const BRANDS: Brand[] = [
  { name: 'Coca-Cola', rarity: 'common', points: 1, color: '#E61A27', weight: 10, logo: 'cocaCola' },
  { name: "McDonald's", rarity: 'common', points: 1, color: '#FFC72C', weight: 10, logo: 'mcdonalds' },
  { name: 'Samsung', rarity: 'common', points: 2, color: '#1428A0', weight: 9, logo: 'samsung' },
  { name: 'Adidas', rarity: 'common', points: 2, color: '#000000', weight: 9, logo: 'adidas' },
  { name: 'Nike', rarity: 'rare', points: 3, color: '#111111', weight: 5, logo: 'nike' },
  { name: 'Starbucks', rarity: 'rare', points: 3, color: '#00704A', weight: 5, logo: 'starbucks' },
  { name: 'Pepsi', rarity: 'rare', points: 4, color: '#004B93', weight: 4 },
  { name: 'Spotify', rarity: 'rare', points: 4, color: '#1DB954', weight: 4, logo: 'spotify' },
  { name: 'Apple', rarity: 'legendary', points: 6, color: '#1A1A1A', weight: 2, logo: 'apple' },
  { name: 'Tesla', rarity: 'legendary', points: 8, color: '#CC0000', weight: 1, logo: 'tesla' },
  { name: 'Rolex', rarity: 'legendary', points: 10, color: '#A37E2C', weight: 1 },
];

/** Total spawn weight (for the cumulative pick). */
const TOTAL_WEIGHT = BRANDS.reduce((sum, b) => sum + b.weight, 0);

/**
 * Cumulative-weight pick: rarer brands (lower weight) appear less often.
 * `rand` is a 0..1 PRNG draw (mulberry32).
 */
export function pickBrand(rand: number): Brand {
  let r = rand * TOTAL_WEIGHT;
  for (const b of BRANDS) {
    r -= b.weight;
    if (r <= 0) return b;
  }
  return BRANDS[0]!;
}

/** Inner SVG markup (logo glyph) for a brand, or null when it has no glyph. */
export function logoSvg(brand: Brand): string | null {
  if (!brand.logo) return null;
  const { path } = LOGOS[brand.logo];
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
}
