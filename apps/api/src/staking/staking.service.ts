import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  earlyUnstakeReturn,
  effectiveStakeCapacity,
  effectiveStakePenalty,
  effectiveStakeRate,
  isStakingBoost,
  stakeAccrual,
  stakeBoostPrice,
  type BoostResponse,
  type ClaimResponse,
  type StakePositionDto,
  type StakingBoost,
  type StakingListResponse,
  type StakingTier,
  type UnstakeResponse,
} from '@lemur/shared';
import type { Stake } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AppError } from '../common/errors/app-error';
import { EconomyService } from '../economy/economy.service';
import { isKnownTier } from './staking.util';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fast Redis barrier window for a claim (the conditional UPDATE is the real guarantee). */
const CLAIM_LOCK_TTL_MS = 5_000;

/** Retries for the optimistic-lock / unique-collision races in stake(). */
const MAX_STAKE_RETRIES = 3;

/**
 * Staking feature service (spec/app/08) — an offline yield engine.
 *
 * Yield drips into a per-position storage bucket at `amount * rateDaily`
 * coins/day and stops at the vault capacity (soft idle). Accrual is lazy (by
 * time delta, no cron); `claim` mints the banked storage as new emission
 * (ledger `stake_yield`), `unstake` returns the principal. One active position
 * per tier; both are top-uppable. All coin movement goes through EconomyService.
 */
@Injectable()
export class StakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly economy: EconomyService,
  ) {}

  // ── GET /staking ───────────────────────────────────────────────────────────

  /** Active positions with lazily-computed (read-only) storage accrual. */
  async list(userId: string): Promise<StakingListResponse> {
    const now = Date.now();
    const baseCapacity = (await this.economy.getEffectiveStats(userId))
      .vaultCapacity;
    const stakes = await this.prisma.stake.findMany({
      where: { userId, status: 'active' },
      orderBy: { startedAt: 'asc' },
    });
    return stakes.map((s) => {
      const capacity = this.effectiveCapacity(s, baseCapacity);
      return this.toDto(s, this.previewStored(s, capacity, now), capacity);
    });
  }

  // ── POST /staking/stake ──────────────────────────────────────────────────

  /**
   * Opens or tops up the user's position of `tier` (one active per tier).
   * Validates amount/tier/minimum, snapshots `rateDaily`, atomically debits
   * coins (ledger `stake`, -amount) and either creates the Stake (unlockAt per
   * term) or folds current storage and increases the principal in place.
   */
  async stake(
    userId: string,
    amount: number,
    tier: StakingTier,
  ): Promise<StakePositionDto> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw AppError.invalidRequest('amount must be a positive integer');
    }
    if (!isKnownTier(tier)) {
      throw AppError.unknownTier();
    }

    const cfg = this.economy.config();
    const tierCfg = cfg.staking[tier];
    if (amount < tierCfg.minStake) {
      throw AppError.amountBelowMin(
        `Minimum stake for ${tier} is ${tierCfg.minStake}`,
      );
    }

    for (let attempt = 0; attempt < MAX_STAKE_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const now = Date.now();
          const baseCapacity = (
            await this.economy.getEffectiveStats(userId, tx)
          ).vaultCapacity;
          const existing = await tx.stake.findFirst({
            where: { userId, tier, status: 'active' },
          });

          // Atomic debit (optimistic-locked) + ledger entry `stake` (-amount).
          await this.economy.debitCoins(tx, userId, amount, 'stake');

          if (existing) {
            // Top-up: fold storage to now, then grow the principal. Guarded on
            // lastClaimAt so a concurrent fold loses (count 0 -> retry).
            const capacity = this.effectiveCapacity(existing, baseCapacity);
            const stored = this.previewStored(existing, capacity, now);
            const updated = await tx.stake.updateMany({
              where: {
                id: existing.id,
                status: 'active',
                lastClaimAt: existing.lastClaimAt,
              },
              data: {
                amount: existing.amount + BigInt(amount),
                storageAccrued: BigInt(stored),
                lastClaimAt: new Date(now),
              },
            });
            if (updated.count === 0) {
              throw AppError.invalidRequest('Concurrent stake update, retry');
            }
            const fresh = await tx.stake.findUniqueOrThrow({
              where: { id: existing.id },
            });
            return this.toDto(fresh, stored, capacity);
          }


          // First position of this tier. The partial unique index makes a racing
          // create throw P2002 (surfaced as a retryable invalid_request).
          const startedAt = new Date(now);
          const unlockAt =
            tierCfg.termDays > 0
              ? new Date(now + tierCfg.termDays * DAY_MS)
              : null;
          const created = await tx.stake.create({
            data: {
              userId,
              amount: BigInt(amount),
              tier,
              rateDaily: tierCfg.rateDaily.toString(),
              storageAccrued: 0n,
              startedAt,
              lastClaimAt: startedAt,
              unlockAt,
              status: 'active',
            },
          });
          // A fresh position has all boost levels 0 → effective cap == base.
          return this.toDto(created, 0, baseCapacity);
        });
      } catch (err) {
        if (this.isRetryable(err) && attempt < MAX_STAKE_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    throw AppError.invalidRequest('Could not complete stake, please retry');
  }

  // ── POST /staking/claim ──────────────────────────────────────────────────

  /**
   * Claims the banked storage of a position into the wallet (mint, ledger
   * `stake_yield`), then resets the bucket and restarts accrual. Idempotent: a
   * fast Redis barrier plus a conditional UPDATE (WHERE lastClaimAt = old)
   * guarantee the yield mints at most once.
   */
  async claim(userId: string, stakeId: string): Promise<ClaimResponse> {
    const acquired = await this.redis.acquireLock(
      `staking:claim:${userId}:${stakeId}`,
      CLAIM_LOCK_TTL_MS,
    );
    if (!acquired) {
      // A concurrent claim is in flight; report a no-op against current balance.
      return this.noopClaim(userId);
    }

    return this.prisma.$transaction(async (tx) => {
      const stake = await tx.stake.findUnique({ where: { id: stakeId } });
      if (!stake || stake.userId !== userId || stake.status !== 'active') {
        throw AppError.stakeNotFound();
      }

      const now = Date.now();
      const baseCapacity = (await this.economy.getEffectiveStats(userId, tx))
        .vaultCapacity;
      const capacity = this.effectiveCapacity(stake, baseCapacity);
      const stored = this.previewStored(stake, capacity, now);
      if (stored <= 0) {
        return this.noopClaim(userId, tx);
      }

      // Conditional reset: only the path that still sees the old anchor mints.
      const updated = await tx.stake.updateMany({
        where: {
          id: stakeId,
          status: 'active',
          lastClaimAt: stake.lastClaimAt,
        },
        data: { storageAccrued: 0n, lastClaimAt: new Date(now) },
      });
      if (updated.count === 0) {
        return this.noopClaim(userId, tx);
      }

      const { coins } = await this.economy.creditCoins(
        tx,
        userId,
        stored,
        'stake_yield',
        stakeId,
      );
      return { claimed: stored, coins: Number(coins) };
    });
  }

  // ── POST /staking/unstake ────────────────────────────────────────────────

  /**
   * Closes a position and returns the principal. A still-locked position needs
   * `confirmEarly`; otherwise it is refused (stake_locked). On a normal exit the
   * banked storage is auto-claimed (ledger `stake_yield`) and the full principal
   * returned. On an early exit the storage is forfeited and the principal is
   * returned minus the tier penalty (a coin sink, logged as a negative `unstake`
   * entry). Idempotent: the status guard closes the position at most once.
   */
  async unstake(
    userId: string,
    stakeId: string,
    confirmEarly = false,
  ): Promise<UnstakeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const stake = await tx.stake.findUnique({ where: { id: stakeId } });
      if (!stake || stake.userId !== userId || stake.status !== 'active') {
        throw AppError.stakeNotFound();
      }

      const now = Date.now();
      const locked = !!stake.unlockAt && now < stake.unlockAt.getTime();
      if (locked && !confirmEarly) {
        throw AppError.stakeLocked();
      }

      const cfg = this.economy.config();
      const tierCfg = cfg.staking[stake.tier as StakingTier];
      const baseCapacity = (await this.economy.getEffectiveStats(userId, tx))
        .vaultCapacity;
      const capacity = this.effectiveCapacity(stake, baseCapacity);
      const stored = this.previewStored(stake, capacity, now);
      const principal = Number(stake.amount);

      // Close (idempotent: status guard). Lost race -> stake_not_found.
      const closed = await tx.stake.updateMany({
        where: { id: stakeId, status: 'active' },
        data: { status: 'closed', closedAt: new Date(now) },
      });
      if (closed.count === 0) {
        throw AppError.stakeNotFound();
      }

      if (locked) {
        // Early exit: forfeit storage, return principal minus penalty (sink).
        // The `unfreeze` boost reduces (or fully waives) the tier penalty.
        const penalty = effectiveStakePenalty(
          tierCfg?.earlyPenalty ?? 0,
          stake.boostUnfreezeLevel,
          cfg,
        );
        const returned = earlyUnstakeReturn(principal, penalty);
        const penaltyCoins = principal - returned;
        const credited = await this.economy.creditCoins(
          tx,
          userId,
          principal,
          'unstake',
          stakeId,
        );
        let coins = credited.coins;
        if (penaltyCoins > 0) {
          const debited = await this.economy.debitCoins(
            tx,
            userId,
            penaltyCoins,
            'unstake',
            stakeId,
          );
          coins = debited.coins;
        }
        return {
          returned,
          claimed: 0,
          penalized: true,
          coins: Number(coins),
        };
      }

      // Normal exit: auto-claim banked storage, then return full principal.
      let claimed = 0;
      if (stored > 0) {
        await this.economy.creditCoins(
          tx,
          userId,
          stored,
          'stake_yield',
          stakeId,
        );
        claimed = stored;
      }
      const { coins } = await this.economy.creditCoins(
        tx,
        userId,
        principal,
        'unstake',
        stakeId,
      );
      return {
        returned: principal,
        claimed,
        penalized: false,
        coins: Number(coins),
      };
    });
  }

  // ── POST /staking/boost ──────────────────────────────────────────────────

  /**
   * Buys one level of `boost` for the user's active position `stakeId`
   * (spec/app/08 §5). Validates the boost enum (-> unknown_boost) and the
   * position (-> stake_not_found), rejects a maxed boost (-> max_level), debits
   * the geometric price (ledger `stake_boost`, -> insufficient_coins) and bumps
   * the matching level column. Storage is folded to `now` first so a `rate`
   * boost only speeds up future accrual (mirrors a top-up). Idempotency/races:
   * the conditional UPDATE is guarded on both `lastClaimAt` and the prior level.
   */
  async boost(
    userId: string,
    stakeId: string,
    rawBoost: string,
  ): Promise<BoostResponse> {
    if (!isStakingBoost(rawBoost)) {
      throw AppError.unknownBoost(`Unknown staking boost: ${rawBoost}`);
    }
    const boost: StakingBoost = rawBoost;
    const cfg = this.economy.config();
    const boostCfg = cfg.stakingBoosts[boost];

    for (let attempt = 0; attempt < MAX_STAKE_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const now = Date.now();
          const stake = await tx.stake.findFirst({
            where: { id: stakeId, userId, status: 'active' },
          });
          if (!stake) {
            throw AppError.stakeNotFound();
          }

          const currentLevel = this.boostLevel(stake, boost);
          if (currentLevel >= boostCfg.maxLevel) {
            throw AppError.maxLevel(
              `${boost} boost is at max level ${boostCfg.maxLevel}`,
            );
          }

          // Price for currentLevel -> currentLevel+1. Debit + ledger `stake_boost`.
          const price = stakeBoostPrice(boost, currentLevel, cfg);
          await this.economy.debitCoins(
            tx,
            userId,
            price,
            'stake_boost',
            stakeId,
          );

          // Fold storage to now with the CURRENT effective rate/cap, so a `rate`
          // boost applies only to future accrual. lastClaimAt is advanced too.
          const baseCapacity = (
            await this.economy.getEffectiveStats(userId, tx)
          ).vaultCapacity;
          const capacity = this.effectiveCapacity(stake, baseCapacity);
          const stored = this.previewStored(stake, capacity, now);

          // Conditional bump: guarded on lastClaimAt AND the prior boost level so
          // a concurrent fold/buy loses (count 0 -> retry).
          const where: Prisma.StakeWhereInput = {
            id: stake.id,
            status: 'active',
            lastClaimAt: stake.lastClaimAt,
          };
          const data: Prisma.StakeUpdateManyMutationInput = {
            storageAccrued: BigInt(stored),
            lastClaimAt: new Date(now),
          };
          if (boost === 'rate') {
            where.boostRateLevel = currentLevel;
            data.boostRateLevel = { increment: 1 };
          } else if (boost === 'capacity') {
            where.boostCapacityLevel = currentLevel;
            data.boostCapacityLevel = { increment: 1 };
          } else {
            where.boostUnfreezeLevel = currentLevel;
            data.boostUnfreezeLevel = { increment: 1 };
          }

          const updated = await tx.stake.updateMany({ where, data });
          if (updated.count === 0) {
            throw AppError.invalidRequest('Concurrent boost update, retry');
          }

          const fresh = await tx.stake.findUniqueOrThrow({
            where: { id: stake.id },
          });
          // Recompute the cap with the (possibly bumped) capacity boost level.
          const freshCapacity = this.effectiveCapacity(fresh, baseCapacity);
          return this.toDto(fresh, stored, freshCapacity);
        });
      } catch (err) {
        if (this.isRetryable(err) && attempt < MAX_STAKE_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    throw AppError.invalidRequest('Could not complete boost, please retry');
  }

  // ── Accrual / boosts ──────────────────────────────────────────────────────

  /**
   * Pure preview of the storage bucket at `now`: folds the yield earned since
   * `lastClaimAt` (at the position's EFFECTIVE rate) into the stored snapshot,
   * capped at the EFFECTIVE vault capacity.
   */
  private previewStored(stake: Stake, capacity: number, now: number): number {
    const elapsedMs = now - stake.lastClaimAt.getTime();
    return stakeAccrual(
      Number(stake.amount),
      this.effectiveRate(stake),
      elapsedMs,
      Number(stake.storageAccrued),
      capacity,
    );
  }

  /** Effective daily yield rate of a position (snapshot rate × `rate` boost). */
  private effectiveRate(stake: Stake): number {
    // Round to the column's 8-decimal precision so client and server agree.
    return +effectiveStakeRate(
      Number(stake.rateDaily),
      stake.boostRateLevel,
      this.economy.config(),
    ).toFixed(8);
  }

  /** Effective storage cap of a position (base vault cap × `capacity` boost). */
  private effectiveCapacity(stake: Stake, baseCapacity: number): number {
    return effectiveStakeCapacity(
      baseCapacity,
      stake.boostCapacityLevel,
      this.economy.config(),
    );
  }

  /** Current level of `boost` on a stake row. */
  private boostLevel(stake: Stake, boost: StakingBoost): number {
    if (boost === 'rate') return stake.boostRateLevel;
    if (boost === 'capacity') return stake.boostCapacityLevel;
    return stake.boostUnfreezeLevel;
  }

  /** Returns a no-op claim result against the user's current balance. */
  private async noopClaim(
    userId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<ClaimResponse> {
    const u = await db.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });
    return { claimed: 0, coins: Number(u?.coins ?? 0n) };
  }

  // ── Mapping ────────────────────────────────────────────────────────────────

  private toDto(
    stake: Stake,
    storageAccrued: number,
    capacity: number,
  ): StakePositionDto {
    return {
      stakeId: stake.id,
      amount: Number(stake.amount),
      tier: stake.tier as StakingTier,
      // EFFECTIVE rate (snapshot × rate boost), as a decimal string.
      rateDaily: this.effectiveRate(stake).toString(),
      unlockAt: stake.unlockAt ? stake.unlockAt.toISOString() : null,
      storageAccrued,
      capacity,
      boosts: {
        rate: stake.boostRateLevel,
        capacity: stake.boostCapacityLevel,
        unfreeze: stake.boostUnfreezeLevel,
      },
      status: stake.status === 'active' ? 'active' : 'closed',
    };
  }

  /** True for optimistic-lock / unique-collision races worth retrying. */
  private isRetryable(err: unknown): boolean {
    if (err instanceof AppError) {
      return err.code === 'invalid_request';
    }
    const code = (err as { code?: string } | null)?.code;
    return code === 'P2002' || code === 'P2034';
  }
}
