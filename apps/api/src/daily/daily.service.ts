import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DailyClaimResponse, DailyStatusResponse } from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { EconomyService } from '../economy/economy.service';
import { AppError } from '../common/errors/app-error';
import {
  msUntilNextUtcMidnight,
  nextUtcMidnight,
  rewardForStreak,
  utcDateOnly,
  utcDayDiff,
} from './daily.util';

/**
 * Daily-bonus streak logic (spec/app/07).
 *
 * Streak rules vs. the last claim's UTC date:
 *   - no previous claim         → streak = 1
 *   - diff == 0 (same UTC day)  → already claimed → daily_already_claimed (409)
 *   - diff == 1 (yesterday)     → streak = last.streak + 1
 *   - diff >= 2 (gap)           → streak = 1 (reset)
 *
 * Idempotency: the DB unique (userId, claimDate) is the real guarantee — a
 * race loses on insert (P2002 → daily_already_claimed). Redis is only a fast
 * barrier with TTL until the next UTC midnight.
 */
@Injectable()
export class DailyService {
  private readonly logger = new Logger(DailyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly economy: EconomyService,
  ) {}

  /** GET /daily — current streak/reward status. */
  async getStatus(userId: string): Promise<DailyStatusResponse> {
    const cfg = this.economy.config();
    const now = new Date();
    const today = utcDateOnly(now);

    const last = await this.prisma.dailyBonusClaim.findFirst({
      where: { userId },
      orderBy: { claimDate: 'desc' },
    });

    let alreadyClaimedToday = false;
    // Streak the user currently stands at (after the last claim).
    let currentStreak = 0;
    // Streak that the NEXT claim would produce.
    let nextStreak: number;

    if (!last) {
      nextStreak = 1;
    } else {
      const diff = utcDayDiff(today, last.claimDate);
      if (diff <= 0) {
        alreadyClaimedToday = true;
        currentStreak = last.streak;
        nextStreak = last.streak + 1; // hypothetical, tomorrow
      } else if (diff === 1) {
        currentStreak = last.streak;
        nextStreak = last.streak + 1;
      } else {
        currentStreak = last.streak;
        nextStreak = 1; // streak broke
      }
    }

    const displayStreak = alreadyClaimedToday ? currentStreak : nextStreak;
    const todayReward = rewardForStreak(
      alreadyClaimedToday ? currentStreak : nextStreak,
      cfg.dailyRewards,
    );
    // Reward of the day that follows today's (next claimable day).
    const nextReward = rewardForStreak(
      alreadyClaimedToday ? currentStreak + 1 : nextStreak + 1,
      cfg.dailyRewards,
    );

    return {
      streak: displayStreak,
      currentDay: Math.min(displayStreak, cfg.dailyRewards.length),
      alreadyClaimedToday,
      todayReward,
      nextReward,
      nextClaimAtUtc: nextUtcMidnight(now).toISOString(),
    };
  }

  /** POST /daily/claim — claim today's bonus (server-authoritative, idempotent). */
  async claim(userId: string): Promise<DailyClaimResponse> {
    const cfg = this.economy.config();
    const now = new Date();
    const today = utcDateOnly(now);

    // Fast Redis barrier (best-effort). Real guarantee is the DB unique below.
    const lockKey = `daily:lock:${userId}:${today.toISOString().slice(0, 10)}`;
    const acquired = await this.redis.acquireLock(
      lockKey,
      msUntilNextUtcMidnight(now),
    );
    if (!acquired) {
      throw AppError.dailyAlreadyClaimed();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.dailyBonusClaim.findFirst({
          where: { userId },
          orderBy: { claimDate: 'desc' },
        });

        let streak: number;
        if (!last) {
          streak = 1;
        } else {
          const diff = utcDayDiff(today, last.claimDate);
          if (diff <= 0) {
            throw AppError.dailyAlreadyClaimed();
          } else if (diff === 1) {
            streak = last.streak + 1;
          } else {
            streak = 1;
          }
        }

        const reward = rewardForStreak(streak, cfg.dailyRewards);

        // DB unique (userId, claimDate) is the idempotency anchor: a concurrent
        // claim for the same UTC day loses here with P2002.
        const claimRow = await tx.dailyBonusClaim.create({
          data: { userId, claimDate: today, streak },
        });

        // Credit coins + ledger(type='daily', refId=claim.id) in the same tx.
        // creditCoins does NOT mint referral passive (daily is not earning).
        const { coins } = await this.economy.creditCoins(
          tx,
          userId,
          reward,
          'daily',
          claimRow.id,
        );

        return { reward, coins: Number(coins), streak };
      });
    } catch (err) {
      // Unique-violation race → treat as already-claimed.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw AppError.dailyAlreadyClaimed();
      }
      throw err;
    }
  }
}
