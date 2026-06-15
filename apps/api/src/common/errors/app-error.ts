import { ERROR_CODES, type ErrorCode } from '@lemur/shared';

/**
 * Domain error carrying a canonical {@link ErrorCode}.
 * The global exception filter maps it to `{ code, message }` + HTTP status.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }

  // ── Convenience factories (one per code) ──────────────────────────────────
  static unauthorized(msg = 'Unauthorized'): AppError {
    return new AppError(ERROR_CODES.UNAUTHORIZED, msg);
  }
  static tokenExpired(msg = 'Token expired'): AppError {
    return new AppError(ERROR_CODES.TOKEN_EXPIRED, msg);
  }
  static rateLimited(msg = 'Rate limit exceeded'): AppError {
    return new AppError(ERROR_CODES.RATE_LIMITED, msg);
  }
  static insufficientEnergy(msg = 'Not enough energy'): AppError {
    return new AppError(ERROR_CODES.INSUFFICIENT_ENERGY, msg);
  }
  static insufficientCoins(msg = 'Not enough coins'): AppError {
    return new AppError(ERROR_CODES.INSUFFICIENT_COINS, msg);
  }
  static invalidRequest(msg = 'Invalid request'): AppError {
    return new AppError(ERROR_CODES.INVALID_REQUEST, msg);
  }
  static dailyAlreadyClaimed(msg = 'Daily bonus already claimed today'): AppError {
    return new AppError(ERROR_CODES.DAILY_ALREADY_CLAIMED, msg);
  }
  static couponBoostLimit(msg = 'Daily coupon-boost limit reached'): AppError {
    return new AppError(ERROR_CODES.COUPON_BOOST_LIMIT, msg);
  }
  static sessionActive(msg = 'A coupon session is already active'): AppError {
    return new AppError(ERROR_CODES.SESSION_ACTIVE, msg);
  }
  static sessionNotFound(msg = 'Session not found'): AppError {
    return new AppError(ERROR_CODES.SESSION_NOT_FOUND, msg);
  }
  static sessionRejected(msg = 'Session rejected'): AppError {
    return new AppError(ERROR_CODES.SESSION_REJECTED, msg);
  }
  static sessionExpired(msg = 'Session expired'): AppError {
    return new AppError(ERROR_CODES.SESSION_EXPIRED, msg);
  }
  static unknownType(msg = 'Unknown upgrade type'): AppError {
    return new AppError(ERROR_CODES.UNKNOWN_TYPE, msg);
  }
  static unknownTier(msg = 'Unknown staking tier'): AppError {
    return new AppError(ERROR_CODES.UNKNOWN_TIER, msg);
  }
  static unknownBoost(msg = 'Unknown staking boost'): AppError {
    return new AppError(ERROR_CODES.UNKNOWN_BOOST, msg);
  }
  static maxLevel(msg = 'Upgrade is at max level'): AppError {
    return new AppError(ERROR_CODES.MAX_LEVEL, msg);
  }
  static amountBelowMin(msg = 'Stake amount below tier minimum'): AppError {
    return new AppError(ERROR_CODES.AMOUNT_BELOW_MIN, msg);
  }
  static stakeLocked(msg = 'Stake is locked'): AppError {
    return new AppError(ERROR_CODES.STAKE_LOCKED, msg);
  }
  static stakeNotFound(msg = 'Stake not found'): AppError {
    return new AppError(ERROR_CODES.STAKE_NOT_FOUND, msg);
  }
}
