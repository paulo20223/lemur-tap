import { Module } from '@nestjs/common';
import { UpgradesService } from './upgrades.service';
import { UpgradesRouter } from './upgrades.router';

/**
 * Upgrades feature module. PrismaService, EconomyService (global EconomyModule)
 * and GameConfigService are available app-wide; the oRPC transport consumes the
 * exported UpgradesRouter.
 */
@Module({
  providers: [UpgradesService, UpgradesRouter],
  exports: [UpgradesRouter],
})
export class UpgradesModule {}
