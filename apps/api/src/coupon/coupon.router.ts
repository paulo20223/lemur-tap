import { Injectable } from '@nestjs/common';
import { authed, rateLimit } from '../orpc/base';
import { CouponService } from './coupon.service';

/** oRPC router fragment for `coupon.*` — authed, rate-limited via the `coupon` window. */
@Injectable()
export class CouponRouter {
  constructor(private readonly coupon: CouponService) {}

  build() {
    return {
      coupon: {
        start: authed.coupon.start
          .use(rateLimit('coupon'))
          .handler(({ context }) => this.coupon.start(context.user!.userId)),
        finish: authed.coupon.finish
          .use(rateLimit('coupon'))
          .handler(({ input, context }) =>
            this.coupon.finish(
              context.user!.userId,
              input.sessionId,
              input.score,
            ),
          ),
        boost: authed.coupon.boost
          .use(rateLimit('coupon'))
          .handler(({ context }) => this.coupon.boost(context.user!.userId)),
      },
    };
  }
}
