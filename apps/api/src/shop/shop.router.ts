import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { ShopService } from './shop.service';

/** oRPC router fragment for `shop.*` — authed catalog/buyBasket/buySkin/equipSkin. */
@Injectable()
export class ShopRouter {
  constructor(private readonly shop: ShopService) {}

  build() {
    return {
      shop: {
        catalog: authed.shop.catalog.handler(({ context }) =>
          this.shop.catalog(context.user!.userId),
        ),
        buyBasket: authed.shop.buyBasket.handler(({ input, context }) =>
          this.shop.buyBasket(context.user!.userId, input.tier, input.currency),
        ),
        buySkin: authed.shop.buySkin.handler(({ input, context }) =>
          this.shop.buySkin(context.user!.userId, input.skinId, input.currency),
        ),
        equipSkin: authed.shop.equipSkin.handler(({ input, context }) =>
          this.shop.equipSkin(context.user!.userId, input.skinId),
        ),
        createStarsInvoice: authed.shop.createStarsInvoice.handler(
          ({ input, context }) =>
            this.shop.createStarsInvoice(context.user!.userId, input),
        ),
      },
    };
  }
}
