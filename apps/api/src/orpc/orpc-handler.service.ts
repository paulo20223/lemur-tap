import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { ORPCError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/node';
import { AppError } from '../common/errors/app-error';
import { STATUS_BY_CODE } from '../common/errors/error-status';
import { RedisService } from '../common/redis/redis.service';
import { GameConfigService } from '../config/game-config.service';
import { AuthRouter } from '../auth/auth.router';
import { UsersRouter } from '../users/users.router';
import { UpgradesRouter } from '../upgrades/upgrades.router';
import { CouponRouter } from '../coupon/coupon.router';
import { DailyRouter } from '../daily/daily.router';
import { StakingRouter } from '../staking/staking.router';
import { ShopRouter } from '../shop/shop.router';
import { ReferralRouter } from '../referral/referral.router';
import { LeaderboardRouter } from '../leaderboard/leaderboard.router';
import type { OrpcContext } from './context';

/**
 * Merges the 9 feature-router fragments into one oRPC router, wraps it in a
 * Node RPCHandler, and exposes a single `handle(req, res)` entry point for the
 * Nest catch-all controller. A root interceptor maps thrown {@link AppError}s
 * to {@link ORPCError}s so the canonical `{ code, message }` + HTTP status
 * (spec/app/10) survives the oRPC transport.
 */
@Injectable()
export class OrpcHandlerService {
  private readonly handler: RPCHandler<OrpcContext>;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly gameConfig: GameConfigService,
    private readonly authRouter: AuthRouter,
    private readonly usersRouter: UsersRouter,
    private readonly upgradesRouter: UpgradesRouter,
    private readonly couponRouter: CouponRouter,
    private readonly dailyRouter: DailyRouter,
    private readonly stakingRouter: StakingRouter,
    private readonly shopRouter: ShopRouter,
    private readonly referralRouter: ReferralRouter,
    private readonly leaderboardRouter: LeaderboardRouter,
  ) {
    const router = {
      ...this.authRouter.build(),
      ...this.usersRouter.build(),
      ...this.upgradesRouter.build(),
      ...this.couponRouter.build(),
      ...this.dailyRouter.build(),
      ...this.stakingRouter.build(),
      ...this.shopRouter.build(),
      ...this.referralRouter.build(),
      ...this.leaderboardRouter.build(),
    };

    this.handler = new RPCHandler(router, {
      interceptors: [
        async ({ next }) => {
          try {
            return await next();
          } catch (e) {
            if (e instanceof AppError) {
              throw new ORPCError(e.code.toUpperCase(), {
                status: STATUS_BY_CODE[e.code],
                message: e.message,
                data: { code: e.code },
              });
            }
            throw e;
          }
        },
      ],
    });
  }

  /** Handles a single oRPC request; returns whether a procedure matched. */
  async handle(req: Request, res: Response): Promise<boolean> {
    const { matched } = await this.handler.handle(req, res, {
      prefix: '/api/v1/rpc',
      context: {
        req,
        services: {
          jwt: this.jwt,
          redis: this.redis,
          gameConfig: this.gameConfig,
        },
      },
    });
    return matched;
  }
}
