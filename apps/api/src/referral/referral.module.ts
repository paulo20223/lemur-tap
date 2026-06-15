import { Module } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { ReferralRouter } from './referral.router';

/**
 * ReferralModule — `referral.list` report. PrismaService and EconomyService are
 * provided globally (foundation), ConfigService via the global ConfigModule;
 * the oRPC transport consumes the exported ReferralRouter.
 */
@Module({
  providers: [ReferralService, ReferralRouter],
  exports: [ReferralService, ReferralRouter],
})
export class ReferralModule {}
