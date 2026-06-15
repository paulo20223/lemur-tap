import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

// ── Foundation infra ────────────────────────────────────────────────────────
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ThrottlerModule } from './common/throttler/throttler.module';
import { GameConfigModule } from './config/game-config.module';
import { EconomyModule } from './economy/economy.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

// ── Feature modules (created by feature agents at these fixed paths) ─────────
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { UpgradesModule } from './upgrades/upgrades.module';
import { CouponModule } from './coupon/coupon.module';
import { DailyModule } from './daily/daily.module';
import { StakingModule } from './staking/staking.module';
import { ShopModule } from './shop/shop.module';
import { ReferralModule } from './referral/referral.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { BotModule } from './bot/bot.module';
import { OrpcModule } from './orpc/orpc.module';

@Module({
  imports: [
    // Single monorepo-root .env (cwd is apps/api when running dev/start); a local
    // apps/api/.env can override. Vars already in process.env (e.g. Docker) win.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    // Global JWT — JwtAuthGuard (global) and AuthModule both consume it.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret',
        signOptions: {
          expiresIn: Number(config.get<string>('JWT_TTL_SEC') ?? 3600),
        },
      }),
    }),

    // Foundation infra (global providers).
    PrismaModule,
    RedisModule,
    GameConfigModule,
    EconomyModule,
    ThrottlerModule,

    // Feature modules.
    AuthModule,
    UsersModule,
    UpgradesModule,
    CouponModule,
    DailyModule,
    StakingModule,
    ShopModule,
    ReferralModule,
    LeaderboardModule,
    BotModule,

    // oRPC transport — single catch-all controller over the merged router.
    OrpcModule,
  ],
  providers: [
    // Global Bearer-JWT guard; the only public route is POST /auth/telegram.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate-limit guard (named throttlers wired in ThrottlerModule).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Map AppError / HttpException → { code, message } + HTTP status.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
