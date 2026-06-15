/**
 * Typed oRPC API client for the Lemur Tap webapp.
 *
 * Contract: `@lemur/shared` (`contract`). Transport: oRPC RPCLink over fetch,
 * mounted at `/api/v1/rpc`. Auth flow:
 *   1. auth.telegram with the raw Telegram initData -> { jwt, profile }.
 *   2. Subsequent calls send `Authorization: Bearer <jwt>` (no initData).
 *   3. On 401 (ORPCError UNAUTHORIZED) we re-auth once with the current
 *      initData and retry the original request exactly once.
 *
 * The JWT is held in memory only (short-lived; re-mintable from initData).
 * Wire shapes are derived from the shared contract — never redefined here.
 * `apiClient` keeps the exact method names/signatures the screens depend on,
 * and `ApiClientError { code, message, status }` carries the server domain code
 * (snake_case) so existing `e.code === '<snake_domain>'` checks keep working.
 */
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import {
  contract,
  type AuthTelegramResponse,
  type ShopCurrency,
  type StakingBoost,
  type StakingTier,
  type UpgradeType,
} from '@lemur/shared';
import { getTelegramContext } from '../telegram';

const API_PREFIX = '/api/v1';

function resolveBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  try {
    if (typeof __API_BASE__ === 'string' && __API_BASE__) {
      return __API_BASE__.replace(/\/+$/, '');
    }
  } catch {
    /* __API_BASE__ not defined in some runtimes */
  }
  // oRPC's RPCLink requires an ABSOLUTE url (it runs `new URL(url)` internally),
  // so a relative '/api/v1' (same-origin proxy mode) throws
  // `"/api/v1/rpc" cannot be parsed as a URL`. Fall back to the current origin:
  // the request still hits the same host and is forwarded by the Vite proxy.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

/** Error thrown by the client carrying the server `{ code, message }` + status. */
export class ApiClientError extends Error {
  /** Server error code (from @lemur/shared ERROR_CODES) or a client fallback. */
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

// In-memory JWT; re-mintable from initData.
let jwt: string | null = null;

const link = new RPCLink({
  url: `${resolveBase()}${API_PREFIX}/rpc`,
  headers: () => (jwt ? { authorization: `Bearer ${jwt}` } : {}),
});

const rpc: ContractRouterClient<typeof contract> = createORPCClient(link);

/** Map any thrown error to the `{ code, message, status }` shape screens expect. */
function toApiClientError(e: unknown): ApiClientError {
  if (e instanceof ORPCError) {
    const domain = (e.data as { code?: string } | undefined)?.code;
    return new ApiClientError(domain ?? e.code.toLowerCase(), e.message, e.status ?? 0);
  }
  return new ApiClientError(
    'unknown_error',
    e instanceof Error ? e.message : 'Request failed',
    0,
  );
}

const isUnauthorized = (e: unknown): boolean =>
  e instanceof ORPCError && (e.status === 401 || e.code === 'UNAUTHORIZED');

/** Exchange initData for a JWT and store it. */
async function authenticateRaw(): Promise<AuthTelegramResponse> {
  const ctx = getTelegramContext();
  const resp = await rpc.auth.telegram({
    initData: ctx.initDataRaw,
    startParam: ctx.startParam ?? undefined,
  });
  jwt = resp.jwt;
  return resp;
}

/** Run a call, re-authenticating once on 401 then retrying exactly once. */
async function call<T>(fn: () => Promise<T>, auth = true): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (auth && isUnauthorized(e)) {
      await authenticateRaw();
      try {
        return await fn();
      } catch (e2) {
        throw toApiClientError(e2);
      }
    }
    throw toApiClientError(e);
  }
}

/** Singleton client; initData is read lazily from the Telegram context. */
export const apiClient = {
  /** Current in-memory JWT, if authenticated. */
  get token(): string | null {
    return jwt;
  },
  /** Drop the in-memory token (e.g. on hard logout). */
  clearToken(): void {
    jwt = null;
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  /** auth.telegram — exchange initData for a JWT. Stores the token. */
  authenticate: (): Promise<AuthTelegramResponse> => call(() => authenticateRaw(), false),

  // ── User ──────────────────────────────────────────────────────────────────
  /** users.me — profile + live balances (energy recomputed server-side). */
  me: () => call(() => rpc.users.me()),
  /** users.config — live economy config. */
  config: () => call(() => rpc.users.config()),

  // ── Coupon ────────────────────────────────────────────────────────────────
  /** coupon.start — open a round; returns sessionId + seed. */
  couponStart: () => call(() => rpc.coupon.start()),
  /** coupon.finish — submit a score; returns reward + new balance. */
  couponFinish: (sessionId: string, score: number) =>
    call(() => rpc.coupon.finish({ sessionId, score })),
  /** coupon.boost — buy the one-shot boost: refills energy + arms the bonus drop. */
  couponBoost: () => call(() => rpc.coupon.boost()),

  // ── Daily ─────────────────────────────────────────────────────────────────
  /** daily.status — streak + reward status. */
  daily: () => call(() => rpc.daily.status()),
  /** daily.claim — claim today's reward. */
  dailyClaim: () => call(() => rpc.daily.claim()),

  // ── Upgrades ──────────────────────────────────────────────────────────────
  /** upgrades.list — state of every branch. */
  upgrades: () => call(() => rpc.upgrades.list()),
  /** upgrades.buy — buy the next level of a branch. */
  buyUpgrade: (type: UpgradeType) => call(() => rpc.upgrades.buy({ type })),

  // ── Staking ───────────────────────────────────────────────────────────────
  /** staking.list — active positions with lazily computed storage accrual. */
  staking: () => call(() => rpc.staking.list()),
  /** staking.stake — open or top up a position. */
  stake: (amount: number, tier: StakingTier) =>
    call(() => rpc.staking.stake({ amount, tier })),
  /** staking.claim — bank a position's storage into the wallet. */
  claimStake: (stakeId: string) => call(() => rpc.staking.claim({ stakeId })),
  /** staking.unstake — close a position; `confirmEarly` accepts the lock penalty. */
  unstake: (stakeId: string, confirmEarly = false) =>
    call(() => rpc.staking.unstake({ stakeId, confirmEarly })),
  /** staking.boost — buy one level of a boost for an active position. */
  boostStake: (stakeId: string, boost: StakingBoost) =>
    call(() => rpc.staking.boost({ stakeId, boost })),

  // ── Shop ──────────────────────────────────────────────────────────────────
  /** shop.catalog — baskets + skins enriched with ownership/equip state. */
  shopCatalog: () => call(() => rpc.shop.catalog()),
  /** shop.buyBasket — buy a basket tier with the chosen currency. */
  buyBasket: (tier: number, currency: ShopCurrency) =>
    call(() => rpc.shop.buyBasket({ tier, currency })),
  /** shop.buySkin — buy a cosmetic skin with the chosen currency. */
  buySkin: (skinId: string, currency: ShopCurrency) =>
    call(() => rpc.shop.buySkin({ skinId, currency })),
  /** shop.equipSkin — equip an owned skin. */
  equipSkin: (skinId: string) => call(() => rpc.shop.equipSkin({ skinId })),
  /**
   * shop.createStarsInvoice — request a Telegram Stars invoice link for a goods
   * item. `ref` is the basket tier as a string for kind 'basket', or the skinId
   * for kind 'skin'. The grant happens server-side on successful_payment, so the
   * client must reload the catalog to observe ownership.
   */
  createStarsInvoice: (kind: 'basket' | 'skin', ref: string) =>
    call(() => rpc.shop.createStarsInvoice({ kind, ref })),

  // ── Referral ──────────────────────────────────────────────────────────────
  /** referral.list — code, link, earnings and paginated referee list. */
  referral: (query?: { limit?: number; cursor?: string }) =>
    call(() => rpc.referral.list({ limit: query?.limit, cursor: query?.cursor })),

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  /** leaderboard.top — global ranking by coins + the viewer's own row. */
  leaderboard: (query?: { limit?: number }) =>
    call(() => rpc.leaderboard.top({ limit: query?.limit })),
};
