import { implement, ORPCError } from '@orpc/server';
import { TokenExpiredError } from '@nestjs/jwt';
import { contract } from '@lemur/shared';
import type { JwtPayload } from '../common/auth/auth-user';
import type { OrpcContext } from './context';

/** Shared contract implementer bound to the per-request {@link OrpcContext}. */
export const base = implement(contract).$context<OrpcContext>();

/**
 * Bearer-JWT authentication. Reads the Authorization header off the raw request
 * (no Nest DI), verifies the token via the JwtService from context, and merges
 * `{ user: { userId } }` into the procedure context. Mirrors JwtAuthGuard.
 */
export const authMiddleware = base.middleware(async ({ context, next }) => {
  const header = context.req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    throw new ORPCError('UNAUTHORIZED', {
      status: 401,
      message: 'Missing bearer token',
      data: { code: 'unauthorized' },
    });
  }
  try {
    const payload = await context.services.jwt.verifyAsync<JwtPayload>(token);
    const userId = payload.userId ?? payload.sub;
    if (!userId) {
      throw new ORPCError('UNAUTHORIZED', {
        status: 401,
        message: 'Invalid token payload',
        data: { code: 'unauthorized' },
      });
    }
    return next({ context: { user: { userId } } });
  } catch (e) {
    if (e instanceof ORPCError) {
      throw e;
    }
    const expired = e instanceof TokenExpiredError;
    throw new ORPCError('UNAUTHORIZED', {
      status: 401,
      message: expired ? 'Token expired' : 'Invalid token',
      data: { code: expired ? 'token_expired' : 'unauthorized' },
    });
  }
});

/** Implementer pre-bound with auth — base for every protected procedure. */
export const authed = base.use(authMiddleware);

type LimitName = 'coupon' | 'auth';

/**
 * Per-name Redis fixed-window rate limiter. Window/max come from the live
 * GameConfig; identity is the authed userId, else the client IP. Redis is a
 * fast barrier (the DB constraints remain the real guarantee, spec/app/11).
 */
export const rateLimit = (name: LimitName) =>
  base.middleware(async ({ context, next }) => {
    const cfg = context.services.gameConfig.get();
    const windowMs =
      name === 'coupon'
        ? cfg.couponRateLimitWindowMs
        : cfg.authRateLimitWindowMs;
    const max =
      name === 'coupon' ? cfg.couponRateLimitMax : cfg.authRateLimitMax;

    const ipHeader = context.req.headers['x-forwarded-for'];
    const ip =
      (Array.isArray(ipHeader) ? ipHeader[0] : ipHeader)
        ?.split(',')[0]
        ?.trim() ??
      context.req.socket.remoteAddress ??
      'unknown';
    const id = context.user?.userId ?? ip;
    const key = `orpc:rl:${name}:${id}`;
    const redis = context.services.redis.raw;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }
    if (count > max) {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        status: 429,
        message: 'Rate limit exceeded',
        data: { code: 'rate_limited' },
      });
    }
    return next();
  });
