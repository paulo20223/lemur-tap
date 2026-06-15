import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { LeaderboardService } from './leaderboard.service';

/** oRPC router fragment for `leaderboard.*` — authed global ranking read. */
@Injectable()
export class LeaderboardRouter {
  constructor(private readonly leaderboard: LeaderboardService) {}

  build() {
    return {
      leaderboard: {
        top: authed.leaderboard.top.handler(({ input, context }) =>
          this.leaderboard.getTop(context.user!.userId, {
            limit: input.limit,
          }),
        ),
      },
    };
  }
}
