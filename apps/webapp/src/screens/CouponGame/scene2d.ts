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
import { LEMUR_SVG, lemurSkinVars, basketTierVars } from './lemur';

/** Normalized fall tuning: SpawnSpec.vy is field-heights/sec after this scale. */
const FALL_SCALE = 5.0;
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
  burst: string;
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
  /**
   * Apply the equipped cosmetic skin to the lemur catcher (spec/app/13). Sets a
   * `data-skin` attribute (for variant styling) and a `--skin-accent` tint var.
   * Purely cosmetic; unknown ids fall back to the default look.
   */
  setSkin: (skinId: string, accent: string) => void;
  /**
   * Apply the active basket tier (spec/app/13) — recolours the woven basket to
   * its metal (wicker → silver → gold). Purely cosmetic; the round-length bonus
   * is server-authoritative. tier 0 = the default starter basket.
   */
  setBasket: (tier: number) => void;
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
  /** Catch-animation progress 0..1 once caught (scoop into the basket). */
  pop: number;
  /** Normalized position at the moment of the catch (scoop origin). */
  catchX: number;
  catchY: number;
}

export function createScene(root: HTMLElement, opts: SceneOptions): SceneHandle {
  const { reducedMotion, classes, onScore } = opts;

  let W = root.clientWidth || 1;
  let H = root.clientHeight || 1;
  let basketX01 = 0.5;
  // Catch-impact squash on the basket: decays 1→0 over the bounce, drives a
  // brief squash-and-stretch on the catcher (placeCatcher reads it each frame).
  let bounce = 0;

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
    const tx = (basketX01 - 0.5) * W;
    let squash = '';
    if (!reducedMotion && bounce > 0) {
      // Envelope 0→1→0 across the bounce: the basket dips and springs back.
      const e = Math.sin((1 - bounce) * Math.PI);
      squash = ` scaleX(${(1 + 0.1 * e).toFixed(3)}) scaleY(${(1 - 0.13 * e).toFixed(3)})`;
    }
    catcher.style.transform = `translateX(${tx}px)${squash}`;
  }

  function setSkin(skinId: string, accent: string): void {
    catcher.dataset.skin = skinId;
    catcher.style.setProperty('--skin-accent', accent);
    // Recolour the lemur's fur/ears/eyes to the equipped skin.
    for (const [k, v] of Object.entries(lemurSkinVars(skinId))) {
      catcher.style.setProperty(k, v);
    }
  }

  function setBasket(tier: number): void {
    catcher.dataset.basket = String(tier);
    // Recolour the woven basket to the active tier's metal.
    for (const [k, v] of Object.entries(basketTierVars(tier))) {
      catcher.style.setProperty(k, v);
    }
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
      catchX: 0,
      catchY: 0,
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
    let scale = 1;
    if (slot.caught) {
      const p = Math.min(1, slot.pop);
      scale = reducedMotion
        ? 1 + p * 0.4
        : p < 0.2
          ? 1 + p * 1.1 // brief acknowledging pop (→ ~1.22)
          : 1.22 - ((p - 0.2) / 0.8) * 1.04; // then shrink down into the basket
    }
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

  /** A short brand-tinted ring that flashes at the catch point. */
  function popBurst(x01: number, y01: number, color: string, legendary: boolean): void {
    if (reducedMotion) return;
    const el = document.createElement('div');
    el.className = classes.burst;
    el.style.left = `${x01 * W}px`;
    el.style.top = `${y01 * H}px`;
    el.style.setProperty('--burst', color);
    if (legendary) el.dataset.rarity = 'legendary';
    field.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function update(dt: number): void {
    // Decay the catch-impact squash, re-placing the basket while it springs.
    if (bounce > 0) {
      bounce = Math.max(0, bounce - dt * 3.5);
      placeCatcher();
    }

    for (const slot of pool) {
      if (!slot.active) continue;

      if (slot.caught) {
        slot.pop += dt * (reducedMotion ? 4 : 4.5);
        const p = Math.min(1, slot.pop);
        if (reducedMotion) {
          slot.el.style.opacity = String(Math.max(0, 1 - p));
        } else {
          // Scoop along an eased arc toward the basket mouth, which tracks the
          // live basket position; tumble a touch and fade out as it drops in.
          const ease = 1 - Math.pow(1 - p, 3);
          slot.x01 = slot.catchX + (basketX01 - slot.catchX) * ease;
          slot.y01 = slot.catchY + (CATCH_Y + 0.07 - slot.catchY) * ease;
          slot.rot += slot.spin * 1.6 * dt;
          slot.el.style.opacity = String(p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.4));
        }
        place(slot);
        if (p >= 1) recycle(slot);
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
        slot.pop = 0;
        slot.catchX = slot.x01;
        slot.catchY = slot.y01;
        if (slot.brand) {
          onScore(slot.brand.points);
          popScore(slot.brand.points, slot.x01);
          popBurst(slot.x01, slot.y01, slot.brand.color, slot.brand.rarity === 'legendary');
        }
        if (!reducedMotion) {
          bounce = 1;
          placeCatcher();
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

  return { setBasketX, setSkin, setBasket, spawnCoupon, update, resize, render, dispose };
}
