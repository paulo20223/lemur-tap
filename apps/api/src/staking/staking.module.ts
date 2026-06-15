import { Module } from '@nestjs/common';
import { StakingService } from './staking.service';
import { StakingRouter } from './staking.router';

/**
 * Staking feature module (spec/app/08). PrismaService, RedisService and
 * EconomyService come from global modules; the oRPC transport consumes the
 * exported StakingRouter.
 */
@Module({
  providers: [StakingService, StakingRouter],
  exports: [StakingRouter],
})
export class StakingModule {}
