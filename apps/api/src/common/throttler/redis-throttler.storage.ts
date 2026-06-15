import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service';

/** Return shape of ThrottlerStorage.increment (not re-exported from root). */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/**
 * Redis-backed throttler storage. Uses INCR + PEXPIRE for the sliding count and
 * a separate block key once the limit is exceeded. TTL/blockDuration are in ms
 * (as passed by @nestjs/throttler v6).
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.raw;
    const countKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    const blockTtl = await client.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockTtl / 1000),
      };
    }

    const totalHits = await client.incr(countKey);
    let pttl = await client.pttl(countKey);
    if (totalHits === 1 || pttl < 0) {
      await client.pexpire(countKey, ttl);
      pttl = ttl;
    }

    if (totalHits > limit) {
      await client.set(blockKey, '1', 'PX', blockDuration);
      return {
        totalHits,
        timeToExpire: Math.ceil(pttl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(pttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
