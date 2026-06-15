/**
 * Canonical error codes and the wire error shape.
 * HTTP status mapping lives on the API side (exception filter) per spec/app/10-api.md.
 */

export const ERROR_CODES = {
  /** Invalid/expired initData or JWT (401). */
  UNAUTHORIZED: 'unauthorized',
  /** Expired JWT — client should re-auth via POST /auth/telegram (401). */
  TOKEN_EXPIRED: 'token_expired',
  /** Rate-limit exceeded (429). */
  RATE_LIMITED: 'rate_limited',
  /** Not enough energy, e.g. starting a coupon round (409). */
  INSUFFICIENT_ENERGY: 'insufficient_energy',
  /** Not enough coins for upgrade/stake (409). */
  INSUFFICIENT_COINS: 'insufficient_coins',
  /** Invalid request body, e.g. score < 0, unknown enum (400). */
  INVALID_REQUEST: 'invalid_request',
  /** Daily already claimed for the current UTC day (409). */
  DAILY_ALREADY_CLAIMED: 'daily_already_claimed',
  /** Starting a coupon round while one is already active (409). */
  SESSION_ACTIVE: 'session_active',
  /** Unknown/foreign coupon session or stake (404). */
  SESSION_NOT_FOUND: 'session_not_found',
  /** finish outside window / score rejected (409). */
  SESSION_REJECTED: 'session_rejected',
  /** finish after expiresAt (409). */
  SESSION_EXPIRED: 'session_expired',
  /** Unknown upgrade type (400). */
  UNKNOWN_TYPE: 'unknown_type',
  /** Unknown staking tier (400). */
  UNKNOWN_TIER: 'unknown_tier',
  /** Unknown staking boost type (400). */
  UNKNOWN_BOOST: 'unknown_boost',
  /** Upgrade already at MAX_LEVEL (409). */
  MAX_LEVEL: 'max_level',
  /** Stake amount below tier minimum (409). */
  AMOUNT_BELOW_MIN: 'amount_below_min',
  /** Early unstake of a locked position (409). */
  STAKE_LOCKED: 'stake_locked',
  /** Missing/foreign/closed stake position (404). */
  STAKE_NOT_FOUND: 'stake_not_found',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Wire shape returned for every error. */
export interface ApiError {
  code: ErrorCode;
  message: string;
}
