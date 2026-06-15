import { Global, Module } from '@nestjs/common';
import { EconomyService } from './economy.service';

/**
 * CORE infra. Global so every feature module can inject EconomyService for
 * energy recompute, effective stats, coin debit/credit and earning credit
 * (with referral-passive minting). See spec/app/05, 09.
 */
@Global()
@Module({
  providers: [EconomyService],
  exports: [EconomyService],
})
export class EconomyModule {}
