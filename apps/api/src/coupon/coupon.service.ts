import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  couponMaxScore,
  couponReward,
  type CouponBoostResponse,
  type CouponStartResponse,
  type CouponFinishResponse,
} from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { EconomyService } from '../economy/economy.service';
import { AppError } from '../common/errors/app-error';

/**
 * Coupon mini-game (spec/app/06, 11). Server-authoritative & idempotent.
 *
 * - start: lazily expires a stale active session, enforces the one-active-session
 *   invariant, requires energy >= couponSessionCost, debits the cost (never
 *   refunded), and creates a session with a server seed + start/expiry window.
 * - finish: validates ownership / active status / finish window, recomputes the
 *   anti-cheat score ceiling from the ACTUAL server-measured elapsed, validates
 *   the self-reported score, credits the floored & capped reward via
 *   EconomyService.creditEarning (which also mints the referral passive), and is
 *   idempotent by sessionId (a replayed finished session returns the same reward).
 */
@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: EconomyService,
  ) {}

  // ── POST /coupon/start ─────────────────────────────────────────────────────
  async start(userId: string): Promise<CouponStartResponse> {
    const cfg = this.economy.config();
    const now = Date.now();

    return this.prisma.$transaction(async (tx) => {
      // Lazily expire a stale active session, freeing the one-active invariant.
      await tx.couponGameSession.updateMany({
        where: { userId, status: 'active', expiresAt: { lt: new Date(now) } },
        data: { status: 'expired' },
      });

      // Enforce one active session per user.
      const active = await tx.couponGameSession.findFirst({
        where: { userId, status: 'active' },
        select: { id: true },
      });
      if (active) {
        throw AppError.sessionActive();
      }

      // Recompute energy lazily and ensure the player can afford the round.
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, energy: true, energyUpdatedAt: true, version: true },
      });
      if (!user) {
        throw AppError.unauthorized('User not found');
      }
      const stats = await this.economy.getEffectiveStats(userId, tx);
      const snapshot = await this.economy.recomputeEnergy(user, now, stats);

      if (snapshot.energy < cfg.couponSessionCost) {
        throw AppError.insufficientEnergy();
      }

      // Debit the session cost from the recomputed energy (not refunded).
      const updated = await tx.user.updateMany({
        where: { id: userId, version: user.version },
        data: {
          energy: snapshot.energy - cfg.couponSessionCost,
          energyUpdatedAt: BigInt(snapshot.energyUpdatedAt),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        // Lost the optimistic race; client may retry.
        throw AppError.invalidRequest('Concurrent update, please retry');
      }

      const startedAt = new Date(now);
      const expiresAt = new Date(
        now + cfg.couponSessionDurationMs + cfg.couponFinishGraceMs,
      );
      // Server-generated seed for deterministic client-side coupon layout.
      const seed = randomInt(0, 2 ** 31);

      const session = await tx.couponGameSession.create({
        data: {
          userId,
          seed: String(seed),
          startedAt,
          expiresAt,
          status: 'active',
        },
        select: { id: true },
      });

      return { sessionId: session.id, seed };
    });
  }

  // ── POST /coupon/boost ─────────────────────────────────────────────────────
  /**
   * Buy the one-shot coupon boost (spec/app/06 §"Буст"). Atomically:
   *  - debits couponBoostPrice coins (ledger type 'coupon_boost'),
   *  - refills energy by couponBoostEnergyGrant (clamped to maxEnergy),
   * so the player can immediately play one more round.
   */
  async boost(userId: string): Promise<CouponBoostResponse> {
    const cfg = this.economy.config();
    const now = Date.now();

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, energy: true, energyUpdatedAt: true, version: true },
      });
      if (!user) {
        throw AppError.unauthorized('User not found');
      }

      // Recompute energy lazily so the grant tops up the live (regenerated) bar.
      const stats = await this.economy.getEffectiveStats(userId, tx);
      const snapshot = await this.economy.recomputeEnergy(user, now, stats);

      // Pay for the boost (throws insufficient_coins / version-race) and write
      // the 'coupon_boost' ledger entry — all in this transaction.
      const { coins } = await this.economy.debitCoins(
        tx,
        userId,
        cfg.couponBoostPrice,
        'coupon_boost',
      );

      // Top up energy for one attempt (clamped to the bar) and arm the drop.
      const grantedEnergy = Math.min(
        snapshot.maxEnergy,
        snapshot.energy + cfg.couponBoostEnergyGrant,
      );
      await tx.user.update({
        where: { id: userId },
        data: {
          energy: grantedEnergy,
          energyUpdatedAt: BigInt(now),
        },
      });

      return {
        coins: Number(coins),
        energy: grantedEnergy,
        energyUpdatedAt: now,
      };
    });
  }

  // ── POST /coupon/finish ────────────────────────────────────────────────────
  async finish(
    userId: string,
    sessionId: string,
    score: number,
  ): Promise<CouponFinishResponse> {
    const cfg = this.economy.config();
    const now = Date.now();

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.couponGameSession.findUnique({
        where: { id: sessionId },
      });
      // Unknown or foreign session.
      if (!session || session.userId !== userId) {
        throw AppError.sessionNotFound();
      }

      // Idempotency: replaying a finished session returns the same reward.
      if (session.status === 'finished') {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { coins: true },
        });
        return {
          reward: Number(session.rewardCoins),
          coins: Number(user?.coins ?? 0n),
        };
      }
      if (session.status === 'rejected') {
        throw AppError.sessionRejected();
      }
      if (session.status === 'expired') {
        throw AppError.sessionExpired();
      }
      // status === 'active' below.

      const startedMs = session.startedAt.getTime();
      const expiresMs = session.expiresAt.getTime();
      const earliestFinishMs = startedMs + cfg.couponSessionDurationMs;

      // Finish too late: expire the session, no reward.
      if (now > expiresMs) {
        await tx.couponGameSession.update({
          where: { id: session.id },
          data: { status: 'expired', finishedAt: new Date(now), score },
        });
        throw AppError.sessionExpired();
      }

      // Finish too early (instant finish): reject, no reward.
      if (now < earliestFinishMs) {
        await tx.couponGameSession.update({
          where: { id: session.id },
          data: { status: 'rejected', finishedAt: new Date(now), score },
        });
        throw AppError.sessionRejected();
      }

      // Anti-cheat ceiling from the ACTUAL server-measured elapsed.
      const elapsedSec =
        Math.min(now - startedMs, cfg.couponSessionDurationMs) / 1000;
      const seedNum = Number(session.seed);
      const maxScore = couponMaxScore(seedNum, elapsedSec, cfg);

      // Validate the self-reported score against the ceiling.
      if (!Number.isInteger(score) || score < 0 || score > maxScore) {
        await tx.couponGameSession.update({
          where: { id: session.id },
          data: { status: 'rejected', finishedAt: new Date(now), score },
        });
        throw AppError.sessionRejected('Score exceeds the allowed maximum');
      }

      // Compute the floored & capped reward using the player's coupon multiplier.
      const stats = await this.economy.getEffectiveStats(userId, tx);
      const reward = couponReward(score, stats.couponMult, cfg);

      // Mark finished BEFORE crediting so the natural sessionId key enforces
      // single-credit (the active partial-unique invariant is also released).
      await tx.couponGameSession.update({
        where: { id: session.id },
        data: {
          status: 'finished',
          finishedAt: new Date(now),
          score,
          rewardCoins: BigInt(reward),
        },
      });

      // Credit earnings (mints the one-level referral passive, type='coupon').
      const { coins } = await this.economy.creditEarning(
        tx,
        userId,
        reward,
        'coupon',
        session.id,
      );

      return { reward, coins: Number(coins) };
    });
  }
}
