import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Thin ioredis wrapper. Used for rate-limit storage and as a fast idempotency
 * barrier (TTL'd locks); the ultimate guarantee is always the DB constraint.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  /** Raw client for advanced ops (e.g. throttler storage). */
  get raw(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs && ttlMs > 0) {
      await this.client.set(key, value, 'PX', ttlMs);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Fast idempotency barrier: returns true if the lock was acquired (key set),
   * false if it already existed. Falls back to allowing the operation (true)
   * on Redis failure — the DB constraint is the real guarantee.
   */
  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    try {
      const res = await this.client.set(key, '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(
        `acquireLock failed for ${key}, falling through to DB: ${
          (err as Error).message
        }`,
      );
      return true;
    }
  }
}
