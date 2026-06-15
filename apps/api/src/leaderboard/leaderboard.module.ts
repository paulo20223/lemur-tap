import { Module } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardRouter } from './leaderboard.router';

/**
 * LeaderboardModule — `leaderboard.top` global ranking by coin balance.
 * PrismaService is provided globally (foundation); the oRPC transport consumes
 * the exported LeaderboardRouter.
 */
@Module({
  providers: [LeaderboardService, LeaderboardRouter],
  exports: [LeaderboardService, LeaderboardRouter],
})
export class LeaderboardModule {}
