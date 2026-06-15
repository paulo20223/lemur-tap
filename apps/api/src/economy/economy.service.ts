import { Injectable } from '@nestjs/common';
import {
  effectiveCouponMult,
  effectiveEnergyRegen,
  effectiveMaxEnergy,
  effectiveVaultCapacity,
  regenEnergy,
  type GameConfig,
  type LedgerType,
  type RefSource,
  type UpgradeType,
} from '@lemur/shared';
import type { User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { PrismaTx } from '../common/prisma/prisma-tx';
import { AppError } from '../common/errors/app-error';
import { GameConfigService } from '../config/game-config.service';

/** Effective per-user stats derived from upgrade levels + config. */
export interface EffectiveStats {
  maxEnergy: number;
  energyRegen: number;
  couponMult: number;
  /** Staking storage cap (coins/day) from the VAULT branch level. */
  vaultCapacity: number;
  levels: Record<UpgradeType, number>;
}

/** Recomputed energy snapshot (whole units + epoch-ms timestamp). */
export interface EnergySnapshot {
  energy: number;
  energyUpdatedAt: number;
  maxEnergy: number;
  energyRegen: number;
}

/**
 * Core economy service injected by every feature module. Centralizes:
 *  - lazy energy recompute (shared regenEnergy),
 *  - effective stats from UserUpgrade rows + GameConfig,
 *  - coin debit/credit with optimistic User.version locking,
 *  - creditEarning: writes the ledger AND mints the one-level referral passive
 *    (10% of coupon income to the referrer, capped, NOT deducted) per
 *    spec/app/09.
 * Feature modules MUST use these helpers instead of duplicating logic.
 */
@Injectable()
export class EconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameConfig: GameConfigService,
  ) {}

  // ── Effective stats ───────────────────────────────────────────────────────

  /** Reads upgrade levels and computes effective stats from config. */
  async getEffectiveStats(
    userId: string,
    db: PrismaTx = this.prisma,
  ): Promise<EffectiveStats> {
    const cfg = this.gameConfig.get();
    const rows = await db.userUpgrade.findMany({ where: { userId } });
    const levels: Record<UpgradeType, number> = {
      maxEnergy: 0,
      energyRegen: 0,
      couponMult: 0,
      vault: 0,
    };
    for (const row of rows) {
      if (row.type in levels) {
        levels[row.type as UpgradeType] = row.level;
      }
    }
    return {
      maxEnergy: effectiveMaxEnergy(levels.maxEnergy, cfg),
      energyRegen: effectiveEnergyRegen(levels.energyRegen, cfg),
      couponMult: effectiveCouponMult(levels.couponMult, cfg),
      vaultCapacity: effectiveVaultCapacity(levels.vault, cfg),
      levels,
    };
  }

  // ── Energy ────────────────────────────────────────────────────────────────

  /**
   * Recomputes a user's energy lazily from the stored snapshot using the shared
   * regenEnergy() and per-user effective regen/max. Pure — does NOT persist.
   * Pass `stats` to avoid a second upgrade lookup inside a transaction.
   */
  async recomputeEnergy(
    user: Pick<User, 'energy' | 'energyUpdatedAt'> & { id?: string },
    now: number,
    stats?: Pick<EffectiveStats, 'maxEnergy' | 'energyRegen'>,
  ): Promise<EnergySnapshot> {
    let maxEnergy: number;
    let energyRegenPerSec: number;
    if (stats) {
      maxEnergy = stats.maxEnergy;
      energyRegenPerSec = stats.energyRegen;
    } else if (user.id) {
      const s = await this.getEffectiveStats(user.id);
      maxEnergy = s.maxEnergy;
      energyRegenPerSec = s.energyRegen;
    } else {
      const cfg = this.gameConfig.get();
      maxEnergy = cfg.baseMaxEnergy;
      energyRegenPerSec = cfg.energyRegen;
    }

    const next = regenEnergy(
      { stored: user.energy, energyUpdatedAt: Number(user.energyUpdatedAt) },
      now,
      energyRegenPerSec,
      maxEnergy,
    );
    return {
      energy: next.stored,
      energyUpdatedAt: next.energyUpdatedAt,
      maxEnergy,
      energyRegen: energyRegenPerSec,
    };
  }

  // ── Coin debit / credit with optimistic locking ───────────────────────────

  /**
   * Atomically decrements coins (e.g. upgrade, stake open) with optimistic
   * locking on User.version. Writes a LedgerEntry for the movement.
   * Throws insufficient_coins if the balance is too low, or a version-conflict
   * AppError if a concurrent mutation won the race (caller may retry).
   */
  async debitCoins(
    tx: PrismaTx,
    userId: string,
    amount: number,
    type: LedgerType,
    refId: string | null = null,
  ): Promise<{ coins: bigint }> {
    if (amount < 0) {
      throw AppError.invalidRequest('Debit amount must be non-negative');
    }
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, coins: true, version: true },
    });
    if (!user) {
      throw AppError.unauthorized('User not found');
    }
    const amt = BigInt(amount);
    if (user.coins < amt) {
      throw AppError.insufficientCoins();
    }

    const updated = await tx.user.updateMany({
      where: { id: userId, version: user.version },
      data: { coins: { decrement: amt }, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      // Lost the optimistic race; caller decides whether to retry.
      throw AppError.invalidRequest('Concurrent balance update, please retry');
    }

    await tx.ledgerEntry.create({
      data: { userId, amount: -amt, type, refId },
    });

    return { coins: user.coins - amt };
  }

  /**
   * Atomically increments coins (e.g. daily, unstake return) with optimistic
   * locking and a ledger entry. Does NOT mint referral passive — use
   * {@link creditEarning} for coupon income that feeds the passive.
   */
  async creditCoins(
    tx: PrismaTx,
    userId: string,
    amount: number,
    type: LedgerType,
    refId: string | null = null,
    refSource: RefSource | null = null,
  ): Promise<{ coins: bigint }> {
    if (amount < 0) {
      throw AppError.invalidRequest('Credit amount must be non-negative');
    }
    const amt = BigInt(amount);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { coins: true, version: true },
    });
    if (!user) {
      throw AppError.unauthorized('User not found');
    }
    const updated = await tx.user.updateMany({
      where: { id: userId, version: user.version },
      data: { coins: { increment: amt }, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw AppError.invalidRequest('Concurrent balance update, please retry');
    }
    if (amount > 0) {
      await tx.ledgerEntry.create({
        data: { userId, amount: amt, type, refId, refSource },
      });
    }
    return { coins: user.coins + amt };
  }

  /**
   * Credits server-authoritative EARNINGS to a user (coupon) and mints the
   * one-level referral passive to the referrer in the SAME transaction.
   *
   * - Writes LedgerEntry(userId, +amount, type, refId).
   * - If the user has a referrer and `type === 'coupon'`, mints
   *   floor(amount * referralPassiveRate) to the referrer as
   *   LedgerEntry(referrerId, +passive, type='referral', refSource='passive',
   *   refId=Referral.id), clamped so lifetime passive never exceeds
   *   referralPassiveCap. The passive is NEW emission (not deducted from the
   *   referee) and is NOT itself a base for further passive (no cascade).
   *
   * Returns the user's new coin balance and the passive actually minted.
   */
  async creditEarning(
    tx: PrismaTx,
    userId: string,
    amount: number,
    type: Extract<LedgerType, 'coupon'>,
    refId: string | null = null,
  ): Promise<{ coins: bigint; passiveMinted: number }> {
    if (amount < 0) {
      throw AppError.invalidRequest('Earning amount must be non-negative');
    }
    const result = await this.creditCoins(tx, userId, amount, type, refId);

    let passiveMinted = 0;
    if (amount > 0) {
      passiveMinted = await this.mintReferralPassive(tx, userId, amount, refId);
    }
    return { coins: result.coins, passiveMinted };
  }

  /**
   * Mints the referral passive to a referee's referrer. Returns coins minted
   * (0 if no referrer / cap reached / cascade base). Internal; called by
   * creditEarning within the same transaction.
   */
  private async mintReferralPassive(
    tx: PrismaTx,
    refereeId: string,
    earnedAmount: number,
    refId: string | null,
  ): Promise<number> {
    const cfg: GameConfig = this.gameConfig.get();
    const referral = await tx.referral.findUnique({
      where: { refereeId },
      select: { id: true, referrerId: true },
    });
    if (!referral) {
      return 0;
    }

    let passive = Math.floor(earnedAmount * cfg.referralPassiveRate);
    if (passive <= 0) {
      return 0;
    }

    // Lifetime passive cap: clamp to remaining headroom.
    const agg = await tx.ledgerEntry.aggregate({
      where: {
        userId: referral.referrerId,
        type: 'referral',
        refSource: 'passive',
      },
      _sum: { amount: true },
    });
    const minted = agg._sum.amount ?? 0n;
    const remaining = BigInt(cfg.referralPassiveCap) - minted;
    if (remaining <= 0n) {
      return 0;
    }
    if (BigInt(passive) > remaining) {
      passive = Number(remaining);
    }
    if (passive <= 0) {
      return 0;
    }

    const amt = BigInt(passive);
    await tx.user.update({
      where: { id: referral.referrerId },
      data: { coins: { increment: amt }, version: { increment: 1 } },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: referral.referrerId,
        amount: amt,
        type: 'referral',
        refSource: 'passive',
        // Trace the passive back to the originating earning entity.
        refId: refId ?? referral.id,
      },
    });
    return passive;
  }

  // ── Persistence helper ────────────────────────────────────────────────────

  /**
   * Persists a recomputed energy snapshot to the User row with optimistic
   * locking. Used by read paths (e.g. GET /me) that recompute energy lazily.
   */
  async persistEnergy(
    tx: PrismaTx,
    userId: string,
    version: number,
    snapshot: Pick<EnergySnapshot, 'energy' | 'energyUpdatedAt'>,
  ): Promise<boolean> {
    const updated = await tx.user.updateMany({
      where: { id: userId, version },
      data: {
        energy: snapshot.energy,
        energyUpdatedAt: BigInt(snapshot.energyUpdatedAt),
        version: { increment: 1 },
      },
    });
    return updated.count > 0;
  }

  // ── Idempotency barrier ───────────────────────────────────────────────────

  /** Convenience config getter for feature modules. */
  config(): GameConfig {
    return this.gameConfig.get();
  }
}
