import { Module } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { CouponRouter } from './coupon.router';

/**
 * Coupon mini-game module (spec/app/06). PrismaModule and the @Global
 * EconomyModule are provided app-wide; the oRPC transport consumes the exported
 * CouponRouter.
 */
@Module({
  providers: [CouponService, CouponRouter],
  exports: [CouponRouter],
})
export class CouponModule {}
