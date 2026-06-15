import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopRouter } from './shop.router';
import { BotModule } from '../bot/bot.module';

/**
 * Shop feature module (spec/app/13). PrismaService, EconomyService (global
 * EconomyModule) and GameConfigService are available app-wide; the oRPC
 * transport consumes the exported ShopRouter.
 *
 * Shop -> Bot is one-directional: ShopService injects BotService to create
 * invoice links and registers its payment callbacks on it at init. The bot
 * does not import the shop, so there is no cycle and no forwardRef.
 */
@Module({
  imports: [BotModule],
  providers: [ShopService, ShopRouter],
  exports: [ShopRouter, ShopService],
})
export class ShopModule {}
