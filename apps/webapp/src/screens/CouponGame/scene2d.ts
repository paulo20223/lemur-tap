/**
 * Framework-free 2D scene for the Coupon Catch mini-game (spec/app/06).
 *
 * Replaces the former three.js scene with a lightweight DOM field: a ring-tailed
 * lemur holding a shopping basket slides along the bottom; brand coupons (cards
 * showing real logos) fall from the top. Catching a coupon (basket x within a
 * forgiveness margin as it crosses the basket line) adds its points and pops a
 * floating "+N". All coordinates are normalized 0..1 across the field, so the
 * deterministic seed-driven schedule (engine.ts) is reused unchanged.
 *
 * The module owns NO React. CouponGame.tsx drives it via the returned handle:
 *   setBasketX, spawnCoupon, update(dt), resize, render, dispose.
 * `onScore` reports points as coupons are caught.
 *
 * Performance (mobile Telegram Mini App): a fixed coupon pool (no per-frame DOM
 * churn), transform/opacity-only animation, and reduced-motion support (no spin
 * or score popups). Caller pauses the RAF when hidden/off-screen.
 */
import { type Brand, logoSvg } from './coupons';

/** Normalized fall tuning: SpawnSpec.vy is field-heights/sec after this scale. */
const FALL_SCALE = 4.0;
/** Spawn just above the top edge (normalized y). */
const SPAWN_Y = -0.12;
/** Basket catch line (normalized y) — where coupons are caught. */
const CATCH_Y = 0.82;
/** Catch window height around the line (normalized y). */
const CATCH_BAND = 0.09;
/** Despawn below this (normalized y). */
const FLOOR_Y = 1.15;
/** Catch forgiveness: basket half-width + margin (normalized x, spec ~0.10). */
const CATCH_HALF_N = 0.2;
/** Object-pool size. */
const POOL_SIZE = 24;
/** Coupon card size in px. */
const CARD_W = 62;
const CARD_H = 78;

/** CSS-module class names supplied by the React layer (keeps theming in CSS). */
export interface SceneClasses {
  field: string;
  coupon: string;
  couponLogo: string;
  couponName: string;
  couponDivider: string;
  couponBadge: string;
  catcher: string;
  pop: string;
}

export interface SceneOptions {
  reducedMotion: boolean;
  classes: SceneClasses;
  /** Called with the caught coupon's points. */
  onScore: (points: number) => void;
}

export interface SceneHandle {
  /** Move the basket; n is normalized 0..1 across the field. */
  setBasketX: (n01: number) => void;
  /** Spawn a coupon at normalized x (0..1) with vy in field-heights/sec. */
  spawnCoupon: (brand: Brand, x01: number, vy: number) => void;
  /** Advance physics by dt seconds (also tests catches). */
  update: (dt: number) => void;
  /** Note the field size in px (dpr unused). */
  resize: (w: number, h: number, dpr?: number) => void;
  /** No-op: update() writes the DOM directly. Kept for handle parity. */
  render: () => void;
  /** Tear down DOM + listeners. */
  dispose: () => void;
}

interface PooledCoupon {
  el: HTMLDivElement;
  active: boolean;
  brand: Brand | null;
  x01: number;
  y01: number;
  /** Fall speed in normalized field-heights per second. */
  vy: number;
  /** Spin speed (deg/s) and current angle. */
  spin: number;
  rot: number;
  caught: boolean;
  /** Pop-out progress 0..1 once caught. */
  pop: number;
}

/** Ring-tailed lemur cradling a woven shopping basket (original cartoon SVG). */
const LEMUR_SVG = `
<svg viewBox="0 0 160 150" width="100%" height="100%" aria-hidden="true">
  <!-- ringed tail, curling up the right side -->
  <path d="M120 120 C155 110 156 60 138 40 C128 28 110 26 104 36"
        fill="none" stroke="#f4f1ee" stroke-width="13" stroke-linecap="round"/>
  <path d="M120 120 C155 110 156 60 138 40 C128 28 110 26 104 36"
        fill="none" stroke="#2b2b2b" stroke-width="13" stroke-linecap="round"
        stroke-dasharray="9 11"/>
  <!-- body -->
  <ellipse cx="80" cy="104" rx="34" ry="30" fill="#9aa0a6"/>
  <ellipse cx="80" cy="108" rx="22" ry="22" fill="#e9e6e2"/>
  <!-- arms hugging the basket -->
  <path d="M52 100 q-12 14 4 26" fill="none" stroke="#9aa0a6" stroke-width="13" stroke-linecap="round"/>
  <path d="M108 100 q12 14 -4 26" fill="none" stroke="#9aa0a6" stroke-width="13" stroke-linecap="round"/>
  <!-- head -->
  <circle cx="80" cy="58" r="30" fill="#9aa0a6"/>
  <!-- ears -->
  <circle cx="54" cy="34" r="11" fill="#9aa0a6"/>
  <circle cx="106" cy="34" r="11" fill="#9aa0a6"/>
  <circle cx="54" cy="34" r="5" fill="#d98c98"/>
  <circle cx="106" cy="34" r="5" fill="#d98c98"/>
  <!-- white face -->
  <path d="M80 30 C100 30 102 54 96 66 C92 76 86 82 80 82 C74 82 68 76 64 66 C58 54 60 30 80 30 Z" fill="#f4f1ee"/>
  <!-- dark eye patches -->
  <ellipse cx="69" cy="56" rx="10" ry="12" fill="#3a3633"/>
  <ellipse cx="91" cy="56" rx="10" ry="12" fill="#3a3633"/>
  <!-- amber eyes -->
  <circle cx="69" cy="57" r="6.5" fill="#e8a33d"/>
  <circle cx="91" cy="57" r="6.5" fill="#e8a33d"/>
  <circle cx="69" cy="57" r="3" fill="#1a1a1a"/>
  <circle cx="91" cy="57" r="3" fill="#1a1a1a"/>
  <circle cx="71" cy="55" r="1.2" fill="#fff"/>
  <circle cx="93" cy="55" r="1.2" fill="#fff"/>
  <!-- muzzle + nose -->
  <ellipse cx="80" cy="72" rx="8" ry="6" fill="#fbf9f7"/>
  <path d="M76 70 h8 l-4 5 Z" fill="#2b2b2b"/>
  <!-- woven shopping basket (the catch zone), drawn in front -->
  <path d="M46 110 H114 L106 142 H54 Z" fill="#c07b34"/>
  <path d="M46 110 H114 L112 118 H48 Z" fill="#9a5f24"/>
  <g stroke="#9a5f24" stroke-width="2" opacity="0.7">
    <line x1="62" y1="118" x2="60" y2="140"/>
    <line x1="80" y1="118" x2="80" y2="140"/>
    <line x1="98" y1="118" x2="100" y2="140"/>
    <line x1="50" y1="126" x2="110" y2="126"/>
    <line x1="52" y1="134" x2="108" y2="134"/>
  </g>
  <path d="M44 110 q36 -22 72 0" fill="none" stroke="#9a5f24" stroke-width="5" stroke-linecap="round"/>
</svg>`;

export function createScene(root: HTMLElement, opts: SceneOptions): SceneHandle {
  const { reducedMotion, classes, onScore } = opts;

  let W = root.clientWidth || 1;
  let H = root.clientHeight || 1;
  let basketX01 = 0.5;

  // Field layer that holds coupons + lemur (positioned over the themed stage).
  const field = document.createElement('div');
  field.className = classes.field;
  root.appendChild(field);

  // ── Lemur + basket catcher ────────────────────────────────────────────────
  const catcher = document.createElement('div');
  catcher.className = classes.catcher;
  catcher.innerHTML = LEMUR_SVG;
  field.appendChild(catcher);

  function placeCatcher(): void {
    catcher.style.transform = `translateX(${(basketX01 - 0.5) * W}px)`;
  }

  // ── Coupon pool ───────────────────────────────────────────────────────────
  const pool: PooledCoupon[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = classes.coupon;
    el.style.width = `${CARD_W}px`;
    el.style.height = `${CARD_H}px`;
    el.style.visibility = 'hidden';
    field.appendChild(el);
    pool.push({
      el,
      active: false,
      brand: null,
      x01: 0,
      y01: 0,
      vy: 0,
      spin: 0,
      rot: 0,
      caught: false,
      pop: 0,
    });
  }

  function paintCard(slot: PooledCoupon, brand: Brand): void {
    const svg = logoSvg(brand);
    const inner = svg
      ? `<span class="${classes.couponLogo}" style="color:${brand.color}">${svg}</span>`
      : `<span class="${classes.couponName}" style="color:${brand.color}">${brand.name}</span>`;
    slot.el.innerHTML =
      `${inner}` +
      `<span class="${classes.couponDivider}" aria-hidden="true"></span>` +
      `<span class="${classes.couponBadge}">+${brand.points}</span>`;
    slot.el.style.setProperty('--accent', brand.color);
    // Rarity drives the premium treatment (gold ring for legendary, etc.).
    slot.el.dataset.rarity = brand.rarity;
  }

  function place(slot: PooledCoupon): void {
    const px = slot.x01 * W - CARD_W / 2;
    const py = slot.y01 * H - CARD_H / 2;
    const scale = slot.caught ? 1 + slot.pop * 0.6 : 1;
    slot.el.style.transform = `translate(${px}px, ${py}px) rotate(${slot.rot}deg) scale(${scale})`;
  }

  function setBasketX(n01: number): void {
    basketX01 = Math.min(1, Math.max(0, n01));
    placeCatcher();
  }

  function spawnCoupon(brand: Brand, x01: number, vy: number): void {
    const slot = pool.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.brand = brand;
    slot.caught = false;
    slot.pop = 0;
    slot.x01 = x01;
    slot.y01 = SPAWN_Y;
    slot.vy = vy * FALL_SCALE;
    slot.rot = 0;
    slot.spin = reducedMotion ? 0 : (Math.random() - 0.5) * 90;
    paintCard(slot, brand);
    slot.el.style.opacity = '1';
    slot.el.style.visibility = 'visible';
    place(slot);
  }

  function recycle(slot: PooledCoupon): void {
    slot.active = false;
    slot.brand = null;
    slot.el.style.visibility = 'hidden';
  }

  function popScore(points: number, x01: number): void {
    if (reducedMotion) return;
    const el = document.createElement('div');
    el.className = classes.pop;
    el.textContent = `+${points}`;
    el.style.left = `${x01 * W}px`;
    el.style.bottom = `${(1 - CATCH_Y) * H}px`;
    field.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function update(dt: number): void {
    for (const slot of pool) {
      if (!slot.active) continue;

      if (slot.caught) {
        slot.pop += dt * 4;
        slot.el.style.opacity = String(Math.max(0, 1 - slot.pop));
        place(slot);
        if (slot.pop >= 1) recycle(slot);
        continue;
      }

      slot.y01 += slot.vy * dt;
      slot.rot += slot.spin * dt;

      // Catch test: crossing the basket line within the forgiveness margin.
      if (
        slot.y01 >= CATCH_Y - CATCH_BAND &&
        slot.y01 <= CATCH_Y + CATCH_BAND &&
        Math.abs(slot.x01 - basketX01) <= CATCH_HALF_N
      ) {
        slot.caught = true;
        if (slot.brand) {
          onScore(slot.brand.points);
          popScore(slot.brand.points, slot.x01);
        }
        place(slot);
        continue;
      }

      if (slot.y01 > FLOOR_Y) {
        recycle(slot);
        continue;
      }
      place(slot);
    }
  }

  function resize(w: number, h: number): void {
    W = Math.max(1, w);
    H = Math.max(1, h);
    placeCatcher();
  }

  function render(): void {
    /* update() writes the DOM directly; nothing to flush here. */
  }

  function dispose(): void {
    field.remove();
  }

  placeCatcher();

  return { setBasketX, spawnCoupon, update, resize, render, dispose };
}
