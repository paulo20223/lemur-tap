import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { ReferralService } from './referral.service';

/** oRPC router fragment for `referral.*` — authed cursor-paginated report. */
@Injectable()
export class ReferralRouter {
  constructor(private readonly referral: ReferralService) {}

  build() {
    return {
      referral: {
        list: authed.referral.list.handler(({ input, context }) =>
          this.referral.getReport(context.user!.userId, {
            limit: input.limit,
            cursor: input.cursor,
          }),
        ),
      },
    };
  }
}
