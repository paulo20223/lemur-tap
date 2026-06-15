import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@lemur/shared';

/**
 * Canonical HTTP status per domain error code (spec/app/10 table).
 * Single source consumed by BOTH the Nest {@link AllExceptionsFilter} (safety
 * net for any non-rpc surface) and the oRPC error interceptor.
 */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ERROR_CODES.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ERROR_CODES.INSUFFICIENT_ENERGY]: HttpStatus.CONFLICT,
  [ERROR_CODES.INSUFFICIENT_COINS]: HttpStatus.CONFLICT,
  [ERROR_CODES.INVALID_REQUEST]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.DAILY_ALREADY_CLAIMED]: HttpStatus.CONFLICT,
  [ERROR_CODES.SESSION_ACTIVE]: HttpStatus.CONFLICT,
  [ERROR_CODES.SESSION_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.SESSION_REJECTED]: HttpStatus.CONFLICT,
  [ERROR_CODES.SESSION_EXPIRED]: HttpStatus.CONFLICT,
  [ERROR_CODES.UNKNOWN_TYPE]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.UNKNOWN_TIER]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.UNKNOWN_BOOST]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.MAX_LEVEL]: HttpStatus.CONFLICT,
  [ERROR_CODES.AMOUNT_BELOW_MIN]: HttpStatus.CONFLICT,
  [ERROR_CODES.STAKE_LOCKED]: HttpStatus.CONFLICT,
  [ERROR_CODES.STAKE_NOT_FOUND]: HttpStatus.NOT_FOUND,
};
