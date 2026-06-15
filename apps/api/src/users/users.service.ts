import { Injectable } from '@nestjs/common';
import type { GameConfig, MeResponse } from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';

/**
 * UsersModule service: read-only profile/config endpoints.
 * Energy is recomputed lazily (server-authoritative) via EconomyService; the
 * fresh snapshot is best-effort persisted so subsequent reads/mutations start
 * from an up-to-date baseline (spec/app/05).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameConfig: GameConfigService,
    private readonly economy: EconomyService,
  ) {}

  /** GET /me — profile + balances with lazily-recomputed energy. */
  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // JWT references a user that no longer exists.
      throw AppError.unauthorized('User not found');
    }

    const now = Date.now();
    const stats = await this.economy.getEffectiveStats(userId);
    const snapshot = await this.economy.recomputeEnergy(user, now, stats);

    // Best-effort persist of the recomputed snapshot. A lost optimistic race
    // means a concurrent mutation already advanced the snapshot — the value we
    // return is still correct for this moment, so we simply skip the write.
    if (
      snapshot.energy !== user.energy ||
      snapshot.energyUpdatedAt !== Number(user.energyUpdatedAt)
    ) {
      await this.economy.persistEnergy(this.prisma, userId, user.version, {
        energy: snapshot.energy,
        energyUpdatedAt: snapshot.energyUpdatedAt,
      });
    }

    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      isPremium: user.isPremium,
      coins: Number(user.coins),
      energy: snapshot.energy,
      maxEnergy: snapshot.maxEnergy,
      energyRegen: snapshot.energyRegen,
      energyUpdatedAt: snapshot.energyUpdatedAt,
      referralCode: user.referralCode,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** GET /config — current economy GameConfig (live cached values). */
  getConfig(): GameConfig {
    return this.gameConfig.get();
  }
}
