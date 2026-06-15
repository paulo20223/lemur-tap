import { Module } from '@nestjs/common';
import { DailyService } from './daily.service';
import { DailyRouter } from './daily.router';

/**
 * Daily-bonus feature module (spec/app/07). PrismaService, RedisService and
 * EconomyService are provided by global modules; the oRPC transport consumes
 * the exported DailyRouter.
 */
@Module({
  providers: [DailyService, DailyRouter],
  exports: [DailyRouter],
})
export class DailyModule {}
