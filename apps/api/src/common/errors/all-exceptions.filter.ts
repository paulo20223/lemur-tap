import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ERROR_CODES,
  type ApiError,
  type ErrorCode,
} from '@lemur/shared';
import { AppError } from './app-error';
import { STATUS_BY_CODE } from './error-status';

/**
 * Maps every thrown error to the canonical `{ code, message }` wire shape with
 * the correct HTTP status (spec/app/10). Order:
 *  - AppError → mapped code + status.
 *  - ThrottlerException → rate_limited (429).
 *  - HttpException (incl. ValidationPipe 400, JwtAuthGuard 401) → best-fit code.
 *  - anything else → 500 invalid_request fallback (logged).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const { status, body } = this.resolve(exception);
    res.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      return {
        status: STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_REQUEST,
        body: { code: exception.code, message: exception.message },
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: {
          code: ERROR_CODES.RATE_LIMITED,
          message: 'Rate limit exceeded',
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = this.httpMessage(exception);
      return {
        status,
        body: { code: this.codeForStatus(status), message },
      };
    }

    this.logger.error(
      `Unhandled exception: ${
        exception instanceof Error ? exception.stack : String(exception)
      }`,
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'Internal server error',
      },
    };
  }

  private httpMessage(exception: HttpException): string {
    const resp = exception.getResponse();
    if (typeof resp === 'string') {
      return resp;
    }
    if (resp && typeof resp === 'object') {
      const m = (resp as { message?: unknown }).message;
      if (Array.isArray(m)) {
        return m.join('; ');
      }
      if (typeof m === 'string') {
        return m;
      }
    }
    return exception.message;
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHORIZED;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.SESSION_NOT_FOUND;
      default:
        return ERROR_CODES.INVALID_REQUEST;
    }
  }
}
