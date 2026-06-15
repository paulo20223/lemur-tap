import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { UpgradesService } from './upgrades.service';

/** oRPC router fragment for `upgrades.*` — authed list/buy. */
@Injectable()
export class UpgradesRouter {
  constructor(private readonly upgrades: UpgradesService) {}

  build() {
    return {
      upgrades: {
        list: authed.upgrades.list.handler(({ context }) =>
          this.upgrades.list(context.user!.userId),
        ),
        buy: authed.upgrades.buy.handler(({ input, context }) =>
          this.upgrades.buy(context.user!.userId, input.type),
        ),
      },
    };
  }
}
