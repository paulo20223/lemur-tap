# Coupon Catch — design + rename spec (2026-06-15)

Lead-architect spec for two locked product decisions in `lemur-tap`:

1. **Remove the Tap mechanic entirely.**
2. **Replace the Fruit minigame with "Coupon Catch"** (a lemur with a basket catches falling brand coupons), rename the whole `fruit` domain to `coupon` across every layer, and make it the **home screen** at route `/`.

This document is the single source of truth for the implementation. It assumes a build pipeline of:
- **Shared phase** (done first, NOT by build agents): `packages/shared/**`.
- **4 parallel build agents**: `api`, `webapp-shell`, `webapp-game`, `spec` — file ownership in §H.

> Conventions reminder (CLAUDE.md): server is authoritative; economy math lives **once** in `packages/shared/src/economy.ts`; money is whole coins, every reward floors; numbers live in DB `GameConfig` (DEFAULT_GAME_CONFIG is seed-only); no cron — lazy accrual; BigInt money serialized as `number`.

---

## Cross-cutting note: the referral coupling (READ FIRST)

Removing `tap` and renaming `fruit→coupon` touches the **referral passive** and **referral activity gate**, which today depend on the `'tap'`/`'fruit'` ledger types. Both effects are handled by the **api** agent. Concretely:

- `EconomyService.creditEarning(type: 'tap' | 'fruit')` → becomes `creditEarning(type: 'coupon')`. The only caller is the coupon finish path. The passive mint logic is unchanged except the type literal.
- `EconomyService.mintReferralPassive` is type-agnostic internally (it just mints a `'referral'`/`'passive'` entry), so no change beyond the caller.
- `ReferralService.hasMinActivity` (apps/api/src/referral/referral.service.ts) currently: (a) counts finished `fruitGameSession` rows → must count `couponGameSession`; (b) sums `ledgerEntry` of `type:'tap'` as a taps proxy → **tap is gone**, so the only activity signal becomes finished coupon sessions. Rewrite `hasMinActivity` to grant the join bonus once the referee has **≥1 finished coupon session** (drop the tap-sum proxy entirely). Keep `referralMinActivityTaps` config field but reinterpret it as "min finished coupon sessions" with default `1` (see §D config changes) — OR keep the threshold semantics minimal: `finishedCoupon >= 1`. Use the latter (simplest, matches "completed a round").
- `AuthService` comment block (lines ~333–338) referencing `['tap','fruit']` activity: update the comment and any `type: { in: [...] }` query to `type: 'coupon'`. Verify there is no executable dependency on `'tap'` beyond the comment; if a query exists it must become `{ type: 'coupon' }`.
- `referral.service.ts` prose comments mentioning "tap/fruit income" → "coupon income".

All ledger `type` strings are free-form `String` columns in Postgres (no DB enum), so renaming literals is purely an application-layer change plus a one-shot data UPDATE for historical rows (§F).

---

## A. Tap removal — exact deletions and edits

**Owner: api (code) + webapp-shell (screens/nav/client/store/App) + spec (docs). Shared phase handles `packages/shared`.**

### A.1 Delete whole files/dirs
| Path | Action |
| --- | --- |
| `apps/api/src/tap/tap.module.ts` | **delete** |
| `apps/api/src/tap/tap.service.ts` | **delete** |
| `apps/api/src/tap/tap.router.ts` | **delete** |
| `apps/api/src/tap/` (dir) | **delete** (empty after above) |
| `apps/webapp/src/screens/Tap/Tap.tsx` | **delete** |
| `apps/webapp/src/screens/Tap/Tap.module.css` | **delete** |
| `apps/webapp/src/screens/Tap/` (dir) | **delete** |
| `packages/shared/src/dto/tap.ts` | **delete** (Shared phase) |

### A.2 Shared-phase edits (packages/shared) — done before build agents
- `packages/shared/src/dto/index.ts`: remove `export * from './tap.js';`.
- `packages/shared/src/dto/tap.ts`: deleted (A.1). `TapRequestSchema`, `TapResponseSchema`, `TapRequest`, `TapResponse` cease to exist.
- `packages/shared/src/enums.ts`:
  - `UpgradeType` union: remove `'tapPower'`.
  - `UPGRADE_TYPES` array: remove `'tapPower'`.
  - `LedgerType` union: remove `'tap'`.
  - `LEDGER_TYPES` array: remove `'tap'`.
- `packages/shared/src/config.ts` — `GameConfigSchema` + `DEFAULT_GAME_CONFIG`:
  - Remove fields: `tapEnergyCost`, `baseTapPower`, `maxTapsPerRequest`, `tapRateLimitWindowMs`, `tapRateLimitMax`.
  - Remove `upgrades.tapPower` branch from the `recordOf(UPGRADE_TYPES, …)` map (drops automatically once `'tapPower'` leaves `UPGRADE_TYPES`, but also remove the `tapPower: { … }` literal in `DEFAULT_GAME_CONFIG.upgrades`).
  - Bump `version` `2 → 3` (new config shape ⇒ new seed row).
- `packages/shared/src/economy.ts`:
  - **Delete** `effectiveTapPower`.
  - In `fruitReward`/`fruitMaxScore` comment headers, the tap references are dropped as part of §B rename.
- `packages/shared/src/contract/index.ts`:
  - Remove the imports `TapRequestSchema`, `TapResponseSchema`.
  - Remove the `tap: oc.input(...).output(...).errors(...)` procedure entirely from `contract`.

### A.3 api-agent edits
- `apps/api/src/app.module.ts`: remove `import { TapModule } …` and remove `TapModule` from `imports`.
- `apps/api/src/orpc/orpc-handler.service.ts`: remove `import { TapRouter } …`, remove the `private readonly tapRouter: TapRouter` ctor param, and remove `...this.tapRouter.build(),` from the merged router.
- `apps/api/src/orpc/base.ts`:
  - `type LimitName = 'tap' | 'fruit' | 'auth'` → `'coupon' | 'auth'` (tap dropped; fruit→coupon per §B).
  - In `rateLimit`, drop the `name === 'tap'` branch; keep `coupon` vs `auth` (windows/max read from the renamed `coupon*` config fields, see §D).
- `apps/api/src/economy/economy.service.ts`:
  - `EffectiveStats.tapPower` field: **remove**.
  - `getEffectiveStats`: remove `tapPower: 0` from the `levels` init record, remove `tapPower: effectiveTapPower(...)` from the returned object, remove the `effectiveTapPower` import.
  - `creditEarning` type param `Extract<LedgerType,'tap'|'fruit'>` → `'coupon'` (see §B/cross-cutting). Internal comment "10% of tap/fruit income" → "10% of coupon income".
- `apps/api/src/common/throttler/throttler.module.ts`:
  - Remove `export const THROTTLER_TAP = 'tap';`.
  - Remove the named tap throttler entry that reads `cfg.tapRateLimitWindowMs`/`cfg.tapRateLimitMax`.
  - Rename `THROTTLER_FRUIT='fruit'` → `THROTTLER_COUPON='coupon'`, reading `cfg.couponRateLimitWindowMs`/`cfg.couponRateLimitMax`.
  - Update header comment "(tap/fruit/auth)" → "(coupon/auth)".
- `apps/api/src/referral/referral.service.ts` + `apps/api/src/auth/auth.service.ts`: per the cross-cutting section (drop tap-sum proxy; finished-coupon-session activity gate; comment fixes).

### A.4 webapp-shell edits
- `apps/webapp/src/App.tsx`:
  - Remove `import Tap from './screens/Tap/Tap';`.
  - Replace `import FruitGame …` with `import CouponGame from './screens/CouponGame/CouponGame';` (path agreed below).
  - Remove `<Route path="/" element={<Tap />} />` and `<Route path="/fruit" element={<FruitGame />} />`.
  - Add `<Route path="/" element={<CouponGame />} />` as the home route.
  - Keep the `<Route path="*" element={<Navigate to="/" replace />} />` fallback.
- `apps/webapp/src/api/client.ts`: remove the `tap:` method (`tap: (taps:number) => call(() => rpc.tap({ taps }))`) and its `// ── Tap ──` comment. (fruit→coupon methods per §B.)
- `apps/webapp/src/store/gameStore.ts`: no tap-specific state exists; just update the doc comment "(tap/fruit/etc.)" → "(coupon/etc.)". `spendEnergy` stays (reused by the coupon start optimistic spend).
- `apps/webapp/src/components/Nav.tsx`: per §B (drop Tap item, rename Fruit→Play/Coupon, fix home `end`).
- `apps/webapp/src/components/icons.tsx` (or `icons/`): `TapIcon` import in Nav is removed; the icon export itself may remain unused — leave it (harmless) OR remove if trivially safe. Decision: **leave `TapIcon` export in place** to avoid touching the icons module from two agents.

### A.5 spec-agent edits (tap removal)
- `spec/app/05-tap-and-energy.md`: rewrite to **"Энергия"** only — delete the Tap sections, keep the lazy energy-regen formula (still used by Coupon start cost + passive regen). Title becomes `# Энергия`. Remove the `POST /tap` endpoint section.
- `CLAUDE.md` spec-map line 12: `[05 — Тап и энергия]` → `[05 — Энергия]`. (label only; filename stays `05-tap-and-energy.md` to avoid churning every cross-link — see §B note.)

---

## B. fruit → coupon rename map

**Owner split: Shared phase renames `packages/shared/**`; `api` renames `apps/api/**`; `webapp-game` renames `apps/webapp/src/screens/FruitGame→CouponGame`; `webapp-shell` updates references in App/client/store/Nav; `spec` renames docs.**

Rename is mechanical and total. The table is the contract — every identifier on the left must become the right, with **no** `fruit`/`Fruit`/`FRUIT` token surviving anywhere in code (grep must come back clean except the historical migration SQL and the kept `05-tap-and-energy.md` filename).

### B.1 Shared (packages/shared)
| OLD | NEW | File |
| --- | --- | --- |
| enum value `'fruitMult'` (UpgradeType / UPGRADE_TYPES) | `'couponMult'` | enums.ts |
| `LedgerType` value `'fruit'` | `'coupon'` | enums.ts |
| `LEDGER_TYPES` member `'fruit'` | `'coupon'` | enums.ts |
| type `FruitSessionStatus` | `CouponSessionStatus` | enums.ts |
| `fruitReward()` | `couponReward()` | economy.ts |
| `fruitMaxScore()` | `couponMaxScore()` | economy.ts |
| `effectiveFruitMult()` | `effectiveCouponMult()` | economy.ts |
| cfg `baseFruitMult` | `baseCouponMult` | config.ts |
| cfg `fruitSessionCost` | `couponSessionCost` | config.ts |
| cfg `fruitSessionDurationMs` | `couponSessionDurationMs` | config.ts |
| cfg `fruitFinishGraceMs` | `couponFinishGraceMs` | config.ts |
| cfg `fruitCoinPerPoint` | `couponCoinPerPoint` | config.ts |
| cfg `fruitMaxCoins` | `couponMaxCoins` | config.ts |
| cfg `fruitMaxPointsPerSec` | `couponMaxPointsPerSec` | config.ts |
| cfg `fruitRateLimitWindowMs` | `couponRateLimitWindowMs` | config.ts |
| cfg `fruitRateLimitMax` | `couponRateLimitMax` | config.ts |
| `upgrades.fruitMult` branch | `upgrades.couponMult` | config.ts (record key follows UPGRADE_TYPES) |
| `FruitStartResponseSchema` / `FruitStartResponse` | `CouponStartResponseSchema` / `CouponStartResponse` | dto/fruit.ts → dto/coupon.ts |
| `FruitFinishRequestSchema` / `FruitFinishRequest` | `CouponFinishRequestSchema` / `CouponFinishRequest` | dto/coupon.ts |
| `FruitFinishResponseSchema` / `FruitFinishResponse` | `CouponFinishResponseSchema` / `CouponFinishResponse` | dto/coupon.ts |
| file `dto/fruit.ts` | `dto/coupon.ts` | rename file |
| `export * from './fruit.js'` | `export * from './coupon.js'` | dto/index.ts |
| contract node `fruit: { start, finish }` | `coupon: { start, finish }` | contract/index.ts |
| dto/common.ts type re-export `FruitSessionStatus` | `CouponSessionStatus` | dto/common.ts |

Error codes: the `ERROR_CODES` keys `SESSION_ACTIVE / SESSION_NOT_FOUND / SESSION_REJECTED / SESSION_EXPIRED` are **kept as-is** (generic "session" codes, already reused). Only update the JSDoc that says "fruit round" → "coupon round" in `errors.ts`.

### B.2 api (apps/api)
| OLD | NEW |
| --- | --- |
| dir `src/fruit/` | `src/coupon/` |
| `fruit.module.ts` `FruitModule` | `coupon.module.ts` `CouponModule` |
| `fruit.service.ts` `FruitService` | `coupon.service.ts` `CouponService` |
| `fruit.router.ts` `FruitRouter` | `coupon.router.ts` `CouponRouter` |
| router key `fruit: { start, finish }` | `coupon: { start, finish }` |
| `authed.fruit.start/finish` | `authed.coupon.start/finish` |
| `rateLimit('fruit')` | `rateLimit('coupon')` |
| `prisma.fruitGameSession` (all call sites) | `prisma.couponGameSession` |
| `fruitMaxScore`, `fruitReward` imports/calls | `couponMaxScore`, `couponReward` |
| `stats.fruitMult` | `stats.couponMult` |
| `creditEarning(..., 'fruit', …)` | `creditEarning(..., 'coupon', …)` |
| `AppError.sessionActive()` default msg "fruit session" | "coupon session" |
| `EconomyService.EffectiveStats.fruitMult` | `couponMult` |
| `effectiveFruitMult` import in economy.service | `effectiveCouponMult` |
| `THROTTLER_FRUIT='fruit'` | `THROTTLER_COUPON='coupon'` |
| app.module `FruitModule` import + listing | `CouponModule` |
| orpc-handler `FruitRouter` import/ctor/`...build()` | `CouponRouter` |
| prisma model `FruitGameSession` | `CouponGameSession` |
| prisma `@@map("fruit_game_sessions")` | `@@map("coupon_game_sessions")` |
| prisma `User.fruitSessions` relation field | `couponSessions` |

### B.3 webapp
| OLD | NEW | Owner |
| --- | --- | --- |
| dir `src/screens/FruitGame/` | `src/screens/CouponGame/` | webapp-game |
| `FruitGame.tsx` default export `FruitGame` | `CouponGame.tsx` default export `CouponGame` | webapp-game |
| `FruitGame.module.css` | `CouponGame.module.css` | webapp-game |
| `engine.ts` `FRUIT_KINDS`, `FruitKind`, `FruitSpriteKey` | replaced by coupon brand model (`coupons.ts`, §G) | webapp-game |
| `FruitSprites.tsx` | replaced by `coupons.ts` texture factory (§G); file deleted | webapp-game |
| `apiClient.fruitStart` | `apiClient.couponStart` | webapp-shell |
| `apiClient.fruitFinish` | `apiClient.couponFinish` | webapp-shell |
| `rpc.fruit.start/finish` | `rpc.coupon.start/finish` | webapp-shell |
| Nav item `{ to:'/fruit', label:'Fruit', Icon:FruitIcon }` | dropped (game is home `/`) | webapp-shell |
| `config.fruitSessionCost` etc. reads | `config.couponSessionCost` etc. | webapp-game |

### B.4 spec docs
| OLD | NEW | Owner |
| --- | --- | --- |
| `spec/app/06-fruit-game.md` | rewrite as Coupon Catch (keep filename `06-...` OR rename to `06-coupon-game.md`) | spec |
| `CLAUDE.md` map line `[06 — Мини-игра «Фрукты»]` | `[06 — Мини-игра «Купоны»]` | spec |
| `spec/orpc/05-procedures.md` `fruit.start/finish` rows | `coupon.start/finish` | spec |

**Filename decision:** rename `06-fruit-game.md` → `06-coupon-game.md` and update the two referrers (`CLAUDE.md` map, `spec/app/README.md`, and any `[06 — …](./06-fruit-game.md)` link). Keep `05-tap-and-energy.md` filename (only its content/label changes) to limit cross-link churn. The spec agent owns all of these.

---

## C. New game design — Coupon Catch

A lemur stands at the bottom of a 3D lane holding a basket. Brand **coupons** (flat cards with a brand wordmark) fall from the top. The player drags the basket horizontally to catch them; each caught coupon adds its point value to `score`. Round = 30 s.

### C.1 Mechanics
- **Round length:** `couponSessionDurationMs` (default 30 000). Reuse the exact value from the old fruit field.
- **Cost:** `couponSessionCost` energy on start (default **250**, unchanged from `fruitSessionCost`). Server debits on `coupon.start`, never refunds. Idempotent `coupon.finish` (replay returns the same reward).
- **Control:** basket x is normalized 0..1; pointer/touch drag moves it (same model as the old FruitGame: `getBoundingClientRect`, clamp 0..1). In 3D, basket world-x = `lerp(-laneHalfWidth, +laneHalfWidth, basketX)`.
- **Catch:** a coupon is caught when its falling y crosses the basket plane and `|couponX - basketX| <= catchHalfWidth` (basket half-width + a small forgiveness margin, tuned ~`0.10` normalized). Caught coupons play a pop/scale-out + particle burst; missed coupons fall past and despawn.
- **Anti-cheat seed model (kept):** server returns a numeric `seed`; the client builds a **deterministic spawn schedule** from `mulberry32(seed)` (rarity weighting, x, fall speed, spawn times). The server's ceiling `couponMaxScore(seed, elapsedSec, cfg)` bounds the accepted `score`. The client targets ≤ ~70 % of the ceiling so a perfect run never trips the bound (same strategy as old `buildSpawnSchedule`).

### C.2 Brand coupon model (real wordmarks, NO logo files)
Brands are rendered as **text wordmarks** on an offscreen 2D canvas turned into a `THREE.CanvasTexture` (§G `coupons.ts`). No copyrighted image assets are bundled — only the brand **name string** drawn in a generic font with the brand's accent color on a card background.

| Brand | Rarity | Points | Card color (hex) | Spawn weight |
| --- | --- | --- | --- | --- |
| Coca-Cola | common | 1 | `#E61A27` | 10 |
| McDonald's | common | 1 | `#FFC72C` | 10 |
| Samsung | common | 2 | `#1428A0` | 9 |
| Adidas | common | 2 | `#000000` | 9 |
| Nike | rare | 3 | `#111111` | 5 |
| Starbucks | rare | 3 | `#00704A` | 5 |
| Pepsi | rare | 4 | `#004B93` | 4 |
| Spotify | rare | 4 | `#1DB954` | 4 |
| Apple | legendary | 6 | `#A2AAAD` | 2 |
| Tesla | legendary | 8 | `#CC0000` | 1 |
| Rolex | legendary | 10 | `#A37E2C` | 1 |

Rules: rarity drives both rarer spawn (lower weight) and higher points. Weighted pick uses cumulative weights against `rand()`. Legendaries fall slightly faster (harder to catch). Keep the list at 11 brands (within the requested 8–12).

> Trademark note: brand names are used nominatively as game flavor; **only text** is rendered, no logos/marks are reproduced as images. This is a deliberate, locked product decision — do not substitute logo files.

### C.3 Scoring
- `score` = Σ points of caught coupons (client-accumulated, server-validated).
- Reward: `couponReward(score, couponMult, cfg) = min(couponMaxCoins, floor(score * couponCoinPerPoint * couponMult))` — see §E for the exact body.
- `couponMult` is the player's effective multiplier from the `couponMult` upgrade branch (`effectiveCouponMult`).
- Ceiling: `couponMaxScore(seed, elapsedSec, cfg) = floor(min(elapsedSec, couponSessionDurationMs/1000) * couponMaxPointsPerSec)`.

### C.4 Energy
- Start costs `couponSessionCost`. Server recomputes energy lazily (shared `regenEnergy`), checks `energy >= couponSessionCost`, debits, opens session. Client optimistically reflects the spend via `gameStore.setEnergyFromServer(energy - cost)` (same as old FruitGame). Finish does NOT touch energy.

---

## D. oRPC contract (zod) — coupon procedures + config changes

**Owner: Shared phase (contract + config + dto). api consumes; webapp consumes.**

### D.1 dto/coupon.ts (renamed from dto/fruit.ts)
```ts
/** Coupon game DTOs. coupon.start, coupon.finish (spec/app/06). */
import * as z from 'zod';

export const CouponStartResponseSchema = z.object({
  sessionId: z.string(),
  /** Server seed for the deterministic client-side coupon spawn schedule. */
  seed: z.number(),
});

export const CouponFinishRequestSchema = z.object({
  sessionId: z.string(),
  /** Self-reported round score; integer >= 0. */
  score: z.number().int().min(0),
});

export const CouponFinishResponseSchema = z.object({
  /** Coins awarded for the round (0 if rejected). */
  reward: z.number(),
  /** New coin balance. */
  coins: z.number(),
});

export type CouponStartResponse = z.infer<typeof CouponStartResponseSchema>;
export type CouponFinishRequest = z.infer<typeof CouponFinishRequestSchema>;
export type CouponFinishResponse = z.infer<typeof CouponFinishResponseSchema>;
```

### D.2 contract/index.ts node
Replace the `fruit` node with (identical typed errors, just renamed schemas):
```ts
coupon: {
  start: oc
    .output(CouponStartResponseSchema)
    .errors({ SESSION_ACTIVE: {}, INSUFFICIENT_ENERGY: {} }),
  finish: oc
    .input(CouponFinishRequestSchema)
    .output(CouponFinishResponseSchema)
    .errors({ SESSION_NOT_FOUND: {}, SESSION_REJECTED: {}, SESSION_EXPIRED: {} }),
},
```
Also remove the entire `tap` procedure node (§A.2). Imports update: drop `Tap*`, replace `Fruit*` with `Coupon*`.

### D.3 GameConfigSchema + DEFAULT_GAME_CONFIG changes

**Remove (tap):** `tapEnergyCost`, `baseTapPower`, `maxTapsPerRequest`, `tapRateLimitWindowMs`, `tapRateLimitMax`, and `upgrades.tapPower`.

**Rename (fruit→coupon):** `baseFruitMult→baseCouponMult`, `fruitSessionCost→couponSessionCost`, `fruitSessionDurationMs→couponSessionDurationMs`, `fruitFinishGraceMs→couponFinishGraceMs`, `fruitCoinPerPoint→couponCoinPerPoint`, `fruitMaxCoins→couponMaxCoins`, `fruitMaxPointsPerSec→couponMaxPointsPerSec`, `fruitRateLimitWindowMs→couponRateLimitWindowMs`, `fruitRateLimitMax→couponRateLimitMax`, `upgrades.fruitMult→upgrades.couponMult`.

**Reinterpret:** `referralMinActivityTaps` — keep the field name and value (`100`) for schema stability, but it is **no longer consulted** for a tap-sum; activity gate becomes "≥1 finished coupon session" (api §A.3 / cross-cutting). (Leaving the field avoids a config schema break for referral; it simply goes unused. Document this in the field's JSDoc.)

**Concrete DEFAULT_GAME_CONFIG values (v3):**
```ts
version: 3,

// Base economy
baseMaxEnergy: 1000,
energyRegen: 1,
// (tapEnergyCost / baseTapPower removed)

// Upgrades
maxLevel: 20,
baseCouponMult: 1,
baseVaultCapacity: 3000,
upgrades: {
  // (tapPower removed)
  maxEnergy:   { base: 2000, mult: 1.8, perLevel: 500 },
  energyRegen: { base: 5000, mult: 2.0, perLevel: 0.5 },
  couponMult:  { base: 3000, mult: 1.7, perLevel: 0.1 }, // coupon_mult(L) = 1 + 0.1*L
  vault:       { base: 8000, mult: 1.8, perLevel: 1500 },
},

// (tap rate-limit block removed)

// Coupon game
couponSessionCost: 250,
couponSessionDurationMs: 30_000,
couponFinishGraceMs: 5_000,
couponCoinPerPoint: 1,
couponMaxCoins: 3000,
couponMaxPointsPerSec: 100, // 3000 coins over 30s ceiling
couponRateLimitWindowMs: 10_000,
couponRateLimitMax: 5,

// dailyRewards, staking, referral*, auth* — UNCHANGED.
```
`UPGRADE_TYPES` is now `['maxEnergy','energyRegen','couponMult','vault']` (4 branches). `recordOf(UPGRADE_TYPES, …)` for both `upgrades` and the effective-stats levels record follows automatically.

---

## E. Economy pure functions (packages/shared/src/economy.ts)

**Owner: Shared phase.**

**Delete** `effectiveTapPower`.

**Rename** `effectiveFruitMult → effectiveCouponMult`:
```ts
/** coupon_mult(L) = baseCouponMult + perLevel * L (0.1 per level). */
export function effectiveCouponMult(level: number, cfg: GameConfig): number {
  return cfg.baseCouponMult + cfg.upgrades.couponMult.perLevel * level;
}
```

**Rename + keep bodies** for the two coupon functions:
```ts
/**
 * Coins awarded for a coupon round:
 * reward = min(couponMaxCoins, floor(score * couponCoinPerPoint * couponMult)).
 */
export function couponReward(
  score: number,
  couponMult: number,
  cfg: GameConfig,
): number {
  const raw = Math.floor(score * cfg.couponCoinPerPoint * couponMult);
  return Math.min(cfg.couponMaxCoins, Math.max(0, raw));
}

/**
 * Deterministic anti-cheat ceiling on an acceptable score.
 * Computed from the server-measured elapsed time, clamped to round duration.
 * Accepted scores satisfy 0 <= score <= couponMaxScore(...).
 * `seed` reserved for future per-coupon layout verification.
 */
export function couponMaxScore(
  seed: number,
  elapsedSec: number,
  cfg: GameConfig,
): number {
  void seed;
  const cappedElapsed = Math.min(
    Math.max(0, elapsedSec),
    cfg.couponSessionDurationMs / 1000,
  );
  return Math.floor(cappedElapsed * cfg.couponMaxPointsPerSec);
}
```
Update the file-header comment source list `06 (fruit)` → `06 (coupon)` and drop the `05 (tap/energy)` tap reference (keep energy).

---

## F. Prisma — model/enum renames + migration plan

**Owner: api.** Dev workflow = `prisma migrate dev` (this is a dev DB; we hand-author the migration so existing rows survive cleanly rather than a destructive reset).

### F.1 schema.prisma edits
- `model FruitGameSession` → `model CouponGameSession`; `@@map("fruit_game_sessions")` → `@@map("coupon_game_sessions")`; column comment `'active'|...` unchanged (status is free-form String). Comment "FRUIT_SESSION_DURATION" → "COUPON_SESSION_DURATION".
- `model User`: relation field `fruitSessions FruitGameSession[]` → `couponSessions CouponGameSession[]`.
- `model UserUpgrade`: comment enumerating types `'tapPower' | ... | 'fruitMult' | 'vault'` → `'maxEnergy' | 'energyRegen' | 'couponMult' | 'vault'`.
- `model LedgerEntry`: comment listing types → drop `'tap'`, `'fruit'`→`'coupon'`.
- (No DB enum types exist; `type`/`status` are `String`, so only data UPDATEs are needed for live rows.)

### F.2 Migration `2_coupon_game` (apps/api/prisma/migrations/2_coupon_game/migration.sql)
Hand-authored SQL (rename table + columns + data backfill). Run via `prisma migrate dev` after editing schema; if Prisma wants to drop/recreate, replace the generated SQL with this:
```sql
-- Rename fruit table -> coupon table (preserves rows/PK/FK).
ALTER TABLE "fruit_game_sessions" RENAME TO "coupon_game_sessions";

-- Rename dependent indexes/constraints to match the new table name.
ALTER INDEX "fruit_game_sessions_userId_status_idx"
  RENAME TO "coupon_game_sessions_userId_status_idx";
ALTER INDEX "fruit_game_sessions_userId_active_key"
  RENAME TO "coupon_game_sessions_userId_active_key";
ALTER TABLE "coupon_game_sessions"
  RENAME CONSTRAINT "fruit_game_sessions_pkey" TO "coupon_game_sessions_pkey";
ALTER TABLE "coupon_game_sessions"
  RENAME CONSTRAINT "fruit_game_sessions_userId_fkey" TO "coupon_game_sessions_userId_fkey";

-- Backfill UserUpgrade rows: rename branch, drop removed tapPower branch.
UPDATE "user_upgrades" SET "type" = 'couponMult' WHERE "type" = 'fruitMult';
DELETE FROM "user_upgrades" WHERE "type" = 'tapPower';

-- Backfill LedgerEntry types: fruit->coupon; tap entries kept for audit
-- (historical), but re-tagged 'coupon' so no orphan type remains? NO — keep
-- 'tap' rows AS-IS for audit integrity (LedgerType union no longer lists 'tap'
-- but the column is free-form String; readers must tolerate legacy 'tap').
UPDATE "ledger_entries" SET "type" = 'coupon' WHERE "type" = 'fruit';
-- (intentionally NOT touching historical 'tap' ledger rows)
```
> Decision on legacy `'tap'` ledger rows: **leave them**. The ledger is an immutable audit; `User.coins` already reconciles to past sums. The TS `LedgerType` union drops `'tap'`, but DTO `LedgerEntrySchema` uses `z.enum(LEDGER_TYPES)` — historical `'tap'` rows would fail validation **if** they were ever serialized through that schema. **Action for api agent:** confirm no endpoint serializes raw ledger entries to the client today (there is no ledger-list procedure in the contract — verified: `referral.list` aggregates, it does not return raw entries). Therefore legacy `'tap'` rows are safe. If a ledger-list endpoint is ever added, switch its `type` field to `z.string()`.

The partial-unique active-session index name string `'active'` predicate is unchanged.

After the SQL: `prisma generate` (script `pnpm prisma:generate`) and re-seed (`pnpm prisma:seed`) to write the v3 `GameConfig` row.

---

## G. Three.js game implementation plan — apps/webapp/src/screens/CouponGame/

**Owner: webapp-game.** Agreed import path used by App.tsx: `./screens/CouponGame/CouponGame` (default export `CouponGame`). webapp-game owns ONLY files under `screens/CouponGame/**`, the deletion of `screens/FruitGame/**`, and `apps/webapp/package.json` (adds `three`). It MUST NOT touch `App.tsx`, `api/client.ts`, `store/gameStore.ts`, or `Nav.tsx`.

### G.1 Files
| File | Responsibility |
| --- | --- |
| `CouponGame.tsx` | React screen. Mounts a single `<canvas>` for WebGL. Renders the HUD overlay (profile header: avatar/username + coins + energy bar; in-round: timer, score, current reward estimate). Phase state machine `idle → countdown → playing → finishing → result` (mirror old FruitGame). Calls `apiClient.couponStart()` / `couponFinish()`. Owns the RAF loop driving `scene.ts`. |
| `scene.ts` | Framework-free THREE scene module. Exports a `createScene(canvas, opts)` returning `{ setBasketX, spawnCoupon, catchCoupon, update(dt), resize(w,h,dpr), render(), dispose() }`. Builds: `PerspectiveCamera`, hemisphere + directional light, subtle `Fog`, a textured ground plane (the "lane"), a lemur+basket `Group` at the bottom, a pooled set of falling-coupon meshes (PlaneGeometry + per-brand CanvasTexture material), and a small GPU-cheap particle burst (Points) for catches. |
| `engine.ts` | Deterministic logic, mirroring the server ceiling. Exports `mulberry32(seed)` and `buildSpawnSchedule(seed, durationSec, maxPointsPerSec)` returning `SpawnSpec[]` `{ t, x, vy, brand }`. Targets total catchable points ≈ `floor(durationSec * maxPointsPerSec * 0.7)` (same 70 % margin as old engine). Weighted brand pick from `coupons.ts`. |
| `coupons.ts` | Brand table (§C.2) `BRANDS: Brand[] = { name, rarity, points, color, weight }` + `makeWordmarkTexture(brand): THREE.CanvasTexture` — draws a rounded-rect coupon card on an offscreen `document.createElement('canvas')` (e.g. 256×160), fills card bg, draws the brand `name` centered in a bold system font in white/contrast over the brand `color` (or color text on light card), adds a faux "perforated edge" + "% OFF" flavor text. Cache one texture per brand (Map) and dispose all on teardown. Also exports `pickBrand(rand)` (cumulative-weight pick) and the catch geometry constants. |
| `CouponGame.module.css` | Layout: full-bleed stage with absolutely-positioned HUD header + footer overlays, countdown/result overlay cards (reuse the old FruitGame.module.css styling vocabulary). |

### G.2 package.json
Add to `apps/webapp/package.json`:
```json
"dependencies": { "three": "^0.169.0", ... },
"devDependencies": { "@types/three": "^0.169.0", ... }
```
(Pin a single recent 0.16x/0.17x pair; keep `three` and `@types/three` versions matched.)

### G.3 Scene composition (scene.ts)
- Camera: `PerspectiveCamera(55, w/h, 0.1, 100)` positioned above-behind the basket looking down the lane (slight tilt) so coupons read as falling toward the player.
- Lights: `HemisphereLight(sky, ground, 0.9)` + one `DirectionalLight` for soft shadow-less shading (skip shadow maps for mobile perf).
- Fog: `THREE.Fog` matching the clear color to fade the lane's far end.
- Ground: large `PlaneGeometry` rotated flat, a procedurally tinted material (no texture file needed); optional gradient via vertex colors.
- Lemur+basket: a `Group` — a simple low-poly lemur built from primitives (sphere head, box body, cylinder limbs) tinted, holding a `basket` (open cylinder / lathe). Keep poly count tiny. `setBasketX(n01)` maps to world-x.
- Coupons: object pool (preallocate ~24 meshes) of `PlaneGeometry(cardW, cardH)` with `MeshBasicMaterial({ map: brandTexture, transparent:true })`, billboarded toward the camera. Falling along world-y; despawn below the basket plane → return to pool. Catch test in `update(dt)` against basket x and the catch plane.
- Particles: a single `Points` system reused for catch bursts (cheap), or per-catch short-lived sprite scale-out.

### G.4 Determinism wiring
- On `couponStart()` success, `engine.buildSpawnSchedule(seed, durationSec, cfg.couponMaxPointsPerSec)`. The RAF loop reads `performance.now()`-based elapsed, spawns coupons whose `t <= elapsed`, advances/draws via `scene.update(dt)` + `scene.render()`, accumulates `scoreRef` on catch.
- At `elapsed >= durationSec`, call `couponFinish(sessionId, scoreRef)`. The score is guaranteed ≤ server ceiling by the 70 % target.

### G.5 Performance / lifecycle (mobile-first Telegram Mini App)
- **DPR cap:** `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`.
- **Pause RAF** when the tab is hidden (`document.visibilitychange` → stop loop) and when the screen unmounts; resume on visible (round time should pause/abandon per spec — abandoning is acceptable since energy is already spent, mirror old FruitGame "leaving abandons the session").
- **Dispose on unmount:** cancel RAF, dispose every geometry, material, CanvasTexture (brand cache), the `WebGLRenderer` (`renderer.dispose()`, `forceContextLoss()`), and remove the canvas. `scene.dispose()` centralizes this.
- **Reduced motion:** if `matchMedia('(prefers-reduced-motion: reduce)')` matches, disable particle bursts and camera idle-sway; coupons still fall (core mechanic) but with no decorative animation.
- **Resize:** observe stage size; on change call `scene.resize(w,h,dpr)` (updates camera aspect + renderer size). Avoid per-frame allocations.

### G.6 Store / API wiring (within CouponGame.tsx only)
- Read `config`, `energy`, `applyProfile`, `setEnergyFromServer` from `useGameStore` (same selectors the old FruitGame used).
- On start: optimistic `setEnergyFromServer(Math.max(0, energy - cfg.couponSessionCost))`.
- On finish: write authoritative `coins` back via `applyProfile({ ...profile, coins: res.coins })`.
- HUD header reads `profile` (username, coins) + live `energy` from the store.
- Error mapping: reuse the friendly-error switch keyed on the same `ERROR_CODES` (`INSUFFICIENT_ENERGY`, `SESSION_ACTIVE`, `RATE_LIMITED`, `SESSION_REJECTED`, `SESSION_EXPIRED`, `SESSION_NOT_FOUND`).

---

## H. File ownership (4 parallel build agents)

Every file assigned to exactly one owner. Shared package (`packages/shared/**`) is handled in the **Shared phase BEFORE** these agents and is owned by none of them.

### Owner: api — `apps/api/**`
- DELETE: `src/tap/` (module, service, router).
- RENAME dir + symbols: `src/fruit/` → `src/coupon/` (`CouponModule/Service/Router`, router key `coupon`, `prisma.couponGameSession`, `couponReward/couponMaxScore`, `stats.couponMult`, `creditEarning(...,'coupon')`).
- EDIT: `src/app.module.ts` (drop TapModule, FruitModule→CouponModule), `src/orpc/orpc-handler.service.ts` (drop TapRouter, FruitRouter→CouponRouter), `src/orpc/base.ts` (LimitName `'coupon'|'auth'`, rateLimit branches + config reads), `src/economy/economy.service.ts` (drop tapPower from EffectiveStats/levels, `effectiveCouponMult`, `creditEarning` type `'coupon'`), `src/common/throttler/throttler.module.ts` (drop tap throttler, `THROTTLER_COUPON`), `src/referral/referral.service.ts` (activity gate = finished coupon sessions; comments), `src/auth/auth.service.ts` (activity comment + any `type:{in:[...]}` → `'coupon'`).
- PRISMA: `prisma/schema.prisma` (model/relation/comment renames), new `prisma/migrations/2_coupon_game/migration.sql`, run `prisma:generate` + `prisma:seed`.
- TESTS: any `apps/api/**` `*.spec.ts` (none exist today; add coupon service/economy-integration tests if creating — see §I).

### Owner: webapp-shell
- `apps/webapp/src/App.tsx` (routes: `/` → CouponGame, remove Tap + `/fruit`).
- `apps/webapp/src/api/client.ts` (remove `tap`; `fruitStart/fruitFinish` → `couponStart/couponFinish` over `rpc.coupon.*`).
- `apps/webapp/src/store/gameStore.ts` (doc-comment only; keep `spendEnergy`).
- `apps/webapp/src/components/Nav.tsx` (remove Tap item; remove `/fruit` item — game is home; keep Daily/Boosts/Stake/Friends; ensure a home nav entry points to `/` with `end`). Decision: Nav items become `[/ (Play), /daily, /upgrades, /staking, /referral]`; the `/` item uses `CouponIcon` (reuse existing `FruitIcon` export renamed at import, or just reuse `TapIcon`/`FruitIcon` — pick `FruitIcon` import aliased as the play icon to avoid editing the icons module).
- `apps/webapp/src/screens/Upgrades/**` (the upgrade list is config-driven via `apiClient.upgrades()`; verify no hardcoded `tapPower`/`fruitMult` labels — if labels are hardcoded, rename `fruitMult`→`couponMult` display and drop `tapPower`).
- DELETE: `apps/webapp/src/screens/Tap/**`.

### Owner: webapp-game
- NEW (only files it may create): `apps/webapp/src/screens/CouponGame/CouponGame.tsx`, `scene.ts`, `engine.ts`, `coupons.ts`, `CouponGame.module.css`.
- DELETE: `apps/webapp/src/screens/FruitGame/**` (`FruitGame.tsx`, `FruitGame.module.css`, `FruitSprites.tsx`, `engine.ts`).
- EDIT: `apps/webapp/package.json` (add `three` + `@types/three`).
- MUST NOT touch `App.tsx`, `api/client.ts`, `store/gameStore.ts`, `Nav.tsx`, or any other file.

### Owner: spec
- `spec/app/05-tap-and-energy.md` (rewrite → energy-only; title `# Энергия`; drop `/tap`).
- `spec/app/06-fruit-game.md` → rename to `06-coupon-game.md`, rewrite as Coupon Catch (mechanics, brand model summary, lifecycle, anti-cheat, balance).
- `spec/app/README.md` (update the `06` link/label if present).
- `CLAUDE.md` spec-map line 12 (labels `05 — Энергия`, `06 — Мини-игра «Купоны»`, and the `06` link target → `06-coupon-game.md`).
- `spec/orpc/05-procedures.md` (`fruit.start/finish` rows → `coupon.start/finish`; drop the `tap` row; rename limit `fruit`→`coupon`).

**Conflict guarantees:** api ↔ webapp-shell ↔ webapp-game ↔ spec touch disjoint path sets. `apps/webapp/package.json` is owned solely by webapp-game. `App.tsx`/`client.ts` solely by webapp-shell. No file appears under two owners.

---

## I. Test changes

No `*.spec.ts` exist in the repo today, so this is mostly **add** (and "delete" = "do not port"):

- **Delete / do not create:** any tap-economy or `/tap` tests. `effectiveTapPower`, tap batch clamping, `maxTapsPerRequest` — gone.
- **Rename:** if porting prior fruit tests, `fruit*` → `coupon*` (`fruitReward`→`couponReward`, etc.).
- **Add (api owner) — coupon economy unit tests** (`packages/shared` is Shared-phase, but if a unit test for economy lives there, the Shared phase adds it; otherwise api adds an integration test). Assert:
  - `couponReward(0, m, cfg) === 0`.
  - `couponReward(score, 1, cfg)` floors: e.g. `couponCoinPerPoint=1`, `score=250` → `250`.
  - Cap: `couponReward(10_000, 5, cfg) === cfg.couponMaxCoins` (3000) — multiplier × points exceeds cap, clamps.
  - Floor with fractional mult: `couponReward(7, 1.1, cfg)` with `couponCoinPerPoint=1` → `floor(7*1.1)=7`.
  - `couponMaxScore(seed, 30, cfg) === 3000` (30 s × 100 pts/s); `couponMaxScore(seed, 0, cfg) === 0`; clamps elapsed above duration (`couponMaxScore(seed, 999, cfg) === 3000`); negative elapsed → `0`.
  - `effectiveCouponMult(0, cfg) === 1`; `effectiveCouponMult(10, cfg) === 2` (1 + 0.1×10).
- **Add (api owner) — CouponService integration tests** (mirror the fruit lifecycle): start debits `couponSessionCost`; second start while active → `SESSION_ACTIVE`; finish before earliest → `SESSION_REJECTED`; finish after `expiresAt` → `SESSION_EXPIRED`; `score > couponMaxScore` → `SESSION_REJECTED` (status persisted `rejected`); valid finish credits `couponReward` and writes a `'coupon'` ledger entry; replayed finish is idempotent (same reward, no double credit); insufficient energy → `INSUFFICIENT_ENERGY`.
- **Add — referral activity test:** join bonus granted after the referee's **first finished coupon session** (no tap path anymore).
- **Add (webapp-game) — engine determinism test:** `buildSpawnSchedule(seed,…)` is deterministic for a fixed seed, and Σ points of the schedule `<= couponMaxScore(seed, durationSec, cfg)` (perfect-run safety against the ceiling).

---

### Appendix: post-rename grep gate (CI / agent self-check)
After all agents finish, these greps over `apps/` + `packages/` (excluding `prisma/migrations/0_init`, `prisma/migrations/1_staking_offline_engine`, and the kept `05-tap-and-energy.md` filename) MUST return nothing:
```
grep -rn --include='*.ts' --include='*.tsx' -e '\bfruit' -e '\bFruit' -e '\bFRUIT' -e 'tapPower' -e 'effectiveTap' -e "'tap'" apps packages
```
Allowed survivors: historical `'tap'` rows in DB only (not code), and the `2_coupon_game` migration SQL which references the old `fruit_game_sessions` name in `RENAME` statements.
