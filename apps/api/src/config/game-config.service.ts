import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_GAME_CONFIG,
  GameConfigSchema,
  type GameConfig,
} from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Loads the latest versioned GameConfig row from the DB and caches it.
 * Falls back to DEFAULT_GAME_CONFIG if the table is empty or unreachable.
 * Economy numbers are editable in the DB without redeploy (spec/app/02).
 */
@Injectable()
export class GameConfigService implements OnModuleInit {
  private readonly logger = new Logger(GameConfigService.name);
  private cached: GameConfig = DEFAULT_GAME_CONFIG;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** Returns the active GameConfig (cached). */
  get(): GameConfig {
    return this.cached;
  }

  /**
   * Re-reads the newest config row whose JSON still matches the current
   * GameConfigSchema. Rows from an older app version (a stale shape, e.g. before
   * a field was added) fail validation and are skipped — serving them as-is
   * would crash readers that expect the new fields. Falls back to
   * DEFAULT_GAME_CONFIG when nothing valid is found.
   */
  async reload(): Promise<GameConfig> {
    try {
      const rows = await this.prisma.gameConfig.findMany({
        orderBy: { version: 'desc' },
      });
      for (const row of rows) {
        const parsed = GameConfigSchema.safeParse(row.data);
        if (parsed.success) {
          this.cached = parsed.data;
          this.logger.log(`Loaded GameConfig v${this.cached.version}`);
          return this.cached;
        }
        this.logger.warn(
          `Skipping GameConfig v${row.version}: shape no longer matches schema`,
        );
      }
      this.cached = DEFAULT_GAME_CONFIG;
      this.logger.warn(
        rows.length
          ? 'No GameConfig row matches the current schema; using DEFAULT_GAME_CONFIG'
          : 'No GameConfig row found; using DEFAULT_GAME_CONFIG',
      );
    } catch (err) {
      this.cached = DEFAULT_GAME_CONFIG;
      this.logger.error(
        `Failed to load GameConfig, using default: ${(err as Error).message}`,
      );
    }
    return this.cached;
  }
}
