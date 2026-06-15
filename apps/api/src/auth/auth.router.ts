import { Injectable } from '@nestjs/common';
import { base, rateLimit } from '../orpc/base';
import { AuthService } from './auth.service';

/** oRPC router fragment for `auth.*` — public, rate-limited via the `auth` window. */
@Injectable()
export class AuthRouter {
  constructor(private readonly auth: AuthService) {}

  build() {
    return {
      auth: {
        telegram: base.auth.telegram
          .use(rateLimit('auth'))
          .handler(({ input }) =>
            this.auth.authenticate(input.initData, input.startParam),
          ),
      },
    };
  }
}
