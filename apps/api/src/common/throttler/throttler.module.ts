import { Module } from '@nestjs/common';
import {
  ThrottlerModule as NestThrottlerModule,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { DEFAULT_GAME_CONFIG } from '@lemur/shared';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/** Named throttlers feature controllers reference via @Throttle. */
export const THROTTLER_COUPON = 'coupon';
export const THROTTLER_AUTH = 'auth';

/**
 * App-wide throttler on Redis storage. Named throttlers (coupon/auth) carry
 * the per-route windows from GameConfig (seeded from DEFAULT_GAME_CONFIG; the
 * defaults here match the seeded row — limits are tuned in the DB without code
 * change for app logic, throttler windows being module-init constants).
 *
 * Controllers opt in with @SkipThrottle({ default: true }) + @Throttle for the
 * specific named throttler, or rely on the default (loose) limit.
 */
@Module({
  imports: [
    RedisModule,
    NestThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService): ThrottlerModuleOptions => {
        const cfg = DEFAULT_GAME_CONFIG;
        return {
          throttlers: [
            // Loose default for general endpoints.
            { name: 'default', ttl: 60_000, limit: 120 },
            {
              name: THROTTLER_COUPON,
              ttl: cfg.couponRateLimitWindowMs,
              limit: cfg.couponRateLimitMax,
            },
            {
              name: THROTTLER_AUTH,
              ttl: cfg.authRateLimitWindowMs,
              limit: cfg.authRateLimitMax,
            },
          ],
          storage: new RedisThrottlerStorage(redis),
        };
      },
    }),
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
