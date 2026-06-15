import { Module } from '@nestjs/common';
import { BotService } from './bot.service';

/**
 * BotModule — the Telegram bot entry point (grammY long-polling).
 * No HTTP controller: the bot opens the Mini App via a web_app button, forwards
 * referral deep-link payloads (spec/app/02, 09) and drives Telegram Stars
 * payments (pre_checkout + successful_payment).
 * ConfigService comes from the global ConfigModule (app.module).
 *
 * The bot does NOT import the shop: ShopService registers its payment callbacks
 * on BotService at init (one-way Shop -> Bot), so there is no DI/import cycle.
 */
@Module({
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
