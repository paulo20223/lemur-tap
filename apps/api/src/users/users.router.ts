import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { UsersService } from './users.service';

/** oRPC router fragment for `users.*` — authed read-only profile/config. */
@Injectable()
export class UsersRouter {
  constructor(private readonly users: UsersService) {}

  build() {
    return {
      users: {
        me: authed.users.me.handler(({ context }) =>
          this.users.getMe(context.user!.userId),
        ),
        config: authed.users.config.handler(() => this.users.getConfig()),
      },
    };
  }
}
