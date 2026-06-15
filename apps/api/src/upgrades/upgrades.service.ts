import { Injectable } from '@nestjs/common';
import {
  isUpgradeType,
  UPGRADE_TYPES,
  upgradePrice,
  type UpgradeBuyResponse,
  type UpgradeStateDto,
  type UpgradesListResponse,
  type UpgradeType,
} from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { EconomyService } from '../economy/economy.service';
import { GameConfigService } from '../config/game-config.service';

/** Max retries for the optimistic-lock buy transaction on a version race. */
const MAX_BUY_RETRIES = 3;

/**
 * Upgrades feature. Server-authoritative pricing/leveling per spec/app/04, 10.
 *
 * Pricing math (upgradePrice, MAX_LEVEL) is the shared, client-identical
 * economy from @lemur/shared. Coin debiting + ledger writing is delegated to
 * EconomyService (optimistic User.version lock); we never duplicate that logic.
 */
@Injectable()
export class UpgradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: EconomyService,
    private readonly gameConfig: GameConfigService,
  ) {}

  /** State of every upgrade branch for the user (level/nextPrice/maxed). */
  async list(userId: string): Promise<UpgradesListResponse> {
    const cfg = this.gameConfig.get();
    const rows = await this.prisma.userUpgrade.findMany({ where: { userId } });

    const levels = new Map<UpgradeType, number>();
    for (const row of rows) {
      if (isUpgradeType(row.type)) {
        levels.set(row.type, row.level);
      }
    }

    return UPGRADE_TYPES.map((type): UpgradeStateDto => {
      const level = levels.get(type) ?? 0;
      return this.toState(type, level, cfg.maxLevel);
    });
  }

  /**
   * Buys one level of `type`:
   *  - validates the upgrade type enum (-> unknown_type),
   *  - rejects when already at MAX_LEVEL (-> max_level),
   *  - atomically debits coins via EconomyService (optimistic version lock,
   *    -> insufficient_coins), writes the `upgrade` ledger entry,
   *  - upserts/increments UserUpgrade.level inside the same transaction.
   *
   * The level read and the increment happen in one interactive transaction
   * keyed on the row's prior level, so concurrent buys cannot skip a price tier.
   */
  async buy(userId: string, rawType: string): Promise<UpgradeBuyResponse> {
    if (!isUpgradeType(rawType)) {
      throw AppError.unknownType(`Unknown upgrade type: ${rawType}`);
    }
    const type: UpgradeType = rawType;
    const cfg = this.gameConfig.get();

    for (let attempt = 0; attempt < MAX_BUY_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.userUpgrade.findUnique({
            where: { userId_type: { userId, type } },
            select: { level: true },
          });
          const currentLevel = existing?.level ?? 0;

          if (currentLevel >= cfg.maxLevel) {
            throw AppError.maxLevel(`${type} is at max level ${cfg.maxLevel}`);
          }

          // Price for the level we're buying (currentLevel -> currentLevel+1).
          const price = upgradePrice(type, currentLevel, cfg);

          // Debit coins (throws insufficient_coins / version-race invalid_request)
          // and write the `upgrade` ledger entry, all within this transaction.
          const { coins } = await this.economy.debitCoins(
            tx,
            userId,
            price,
            'upgrade',
          );

          // Apply the level increment, keyed on the level we priced against so a
          // concurrent buy that already bumped it loses (count === 0 -> retry).
          if (existing) {
            const bumped = await tx.userUpgrade.updateMany({
              where: { userId, type, level: currentLevel },
              data: { level: { increment: 1 } },
            });
            if (bumped.count === 0) {
              // Concurrent buy advanced the level; abort & retry the whole tx.
              throw AppError.invalidRequest('Concurrent upgrade, please retry');
            }
          } else {
            // First level for this branch. Unique(userId,type) makes a racing
            // create throw P2002, surfaced as a retryable invalid_request.
            await tx.userUpgrade.create({
              data: { userId, type, level: 1 },
            });
          }

          const newLevel = currentLevel + 1;
          return {
            type,
            level: newLevel,
            nextPrice:
              newLevel >= cfg.maxLevel
                ? null
                : upgradePrice(type, newLevel, cfg),
            coins: Number(coins),
          } satisfies UpgradeBuyResponse;
        });
      } catch (err) {
        if (this.isRetryable(err) && attempt < MAX_BUY_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    // Exhausted retries on contention.
    throw AppError.invalidRequest('Could not complete upgrade, please retry');
  }

  /** Builds a branch state DTO from a level and the configured cap. */
  private toState(
    type: UpgradeType,
    level: number,
    maxLevel: number,
  ): UpgradeStateDto {
    const maxed = level >= maxLevel;
    return {
      type,
      level,
      nextPrice: maxed ? null : upgradePrice(type, level, this.gameConfig.get()),
      maxed,
    };
  }

  /** True for optimistic-lock / unique-collision races worth retrying. */
  private isRetryable(err: unknown): boolean {
    // EconomyService.debitCoins and our updateMany guard surface lost races as
    // an invalid_request AppError; a racing create surfaces as Prisma P2002.
    if (err instanceof AppError) {
      return err.code === 'invalid_request';
    }
    const code = (err as { code?: string } | null)?.code;
    return code === 'P2002' || code === 'P2034';
  }
}
