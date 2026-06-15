import { Module } from '@nestjs/common';
import { RedisModule } from '../common/redis/redis.module';
import { GameConfigModule } from '../config/game-config.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UpgradesModule } from '../upgrades/upgrades.module';
import { CouponModule } from '../coupon/coupon.module';
import { DailyModule } from '../daily/daily.module';
import { StakingModule } from '../staking/staking.module';
import { ReferralModule } from '../referral/referral.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { OrpcController } from './orpc.controller';
import { OrpcHandlerService } from './orpc-handler.service';

/**
 * oRPC transport module. Imports the 8 feature modules (each exporting its
 * router fragment) plus Redis/GameConfig (JwtModule is global). Wires the
 * merged handler behind the single catch-all controller.
 */
@Module({
  imports: [
    RedisModule,
    GameConfigModule,
    AuthModule,
    UsersModule,
    UpgradesModule,
    CouponModule,
    DailyModule,
    StakingModule,
    ReferralModule,
    LeaderboardModule,
  ],
  controllers: [OrpcController],
  providers: [OrpcHandlerService],
})
export class OrpcModule {}
