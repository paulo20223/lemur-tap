import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { DailyService } from './daily.service';

/** oRPC router fragment for `daily.*` — authed status/claim. */
@Injectable()
export class DailyRouter {
  constructor(private readonly daily: DailyService) {}

  build() {
    return {
      daily: {
        status: authed.daily.status.handler(({ context }) =>
          this.daily.getStatus(context.user!.userId),
        ),
        claim: authed.daily.claim.handler(({ context }) =>
          this.daily.claim(context.user!.userId),
        ),
      },
    };
  }
}
