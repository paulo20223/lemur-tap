import { Module } from '@nestjs/common';
import { BotService } from './bot.service';

/**
 * BotModule — the Telegram bot entry point (grammY long-polling).
 * No HTTP controller: the bot only opens the Mini App via a web_app button and
 * forwards referral deep-link payloads (spec/app/02, 09). ConfigService comes
 * from the global ConfigModule (app.module).
 */
@Module({
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
