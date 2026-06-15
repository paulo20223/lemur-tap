import { Injectable } from '@nestjs/common';
import { authed } from '../orpc/base';
import { StakingService } from './staking.service';

/** oRPC router fragment for `staking.*` — authed list/stake/claim/unstake. */
@Injectable()
export class StakingRouter {
  constructor(private readonly staking: StakingService) {}

  build() {
    return {
      staking: {
        list: authed.staking.list.handler(({ context }) =>
          this.staking.list(context.user!.userId),
        ),
        stake: authed.staking.stake.handler(({ input, context }) =>
          this.staking.stake(context.user!.userId, input.amount, input.tier),
        ),
        claim: authed.staking.claim.handler(({ input, context }) =>
          this.staking.claim(context.user!.userId, input.stakeId),
        ),
        unstake: authed.staking.unstake.handler(({ input, context }) =>
          this.staking.unstake(
            context.user!.userId,
            input.stakeId,
            input.confirmEarly ?? false,
          ),
        ),
        boost: authed.staking.boost.handler(({ input, context }) =>
          this.staking.boost(context.user!.userId, input.stakeId, input.boost),
        ),
      },
    };
  }
}
