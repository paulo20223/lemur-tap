import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard } from 'grammy';

/**
 * BotService — minimal grammY Telegram bot for Lemur Tap (spec/app/02, 09).
 *
 * Responsibilities:
 *  - `/start` command replying with a WebApp button (`web_app`) opening WEBAPP_URL.
 *  - Referral deep links: `https://t.me/<bot>?start=ref_<code>` → the `ref_<code>`
 *    payload arrives as `ctx.match`; it is forwarded into the Mini App URL so the
 *    webapp can pass it back to `POST /auth/telegram` (referrer is bound there).
 *  - Runs long-polling in dev; no-ops (with a warning) if the token is missing,
 *    so the API still boots without a bot configured.
 *
 * There are no HTTP endpoints here — binding/bonuses are handled by AuthModule /
 * ReferralModule; the bot is purely the Telegram entry point.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token || token.includes('your-bot-token')) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is unset/placeholder — Telegram bot disabled.',
      );
      return;
    }

    const bot = new Bot(token);
    this.bot = bot;

    this.registerHandlers(bot);

    // Long-polling for dev. Do NOT await bot.start() — it resolves only when the
    // bot stops; fire-and-forget so Nest bootstrap completes.
    void bot
      .start({
        onStart: (info) =>
          this.logger.log(`Telegram bot @${info.username} started (polling).`),
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Telegram bot polling failed: ${(err as Error).message}`,
        );
      });

    // Register the command list shown in the Telegram UI (best-effort).
    try {
      await bot.api.setMyCommands([
        { command: 'start', description: 'Launch Lemur Tap' },
      ]);
    } catch (err) {
      this.logger.warn(
        `setMyCommands failed: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.logger.log('Telegram bot stopped.');
    }
  }

  private registerHandlers(bot: Bot): void {
    bot.command('start', async (ctx) => {
      // Deep-link payload: grammY extracts the `?start=<payload>` value into ctx.match.
      const payload = (ctx.match ?? '').trim();
      const url = this.buildWebAppUrl(payload);

      const keyboard = new InlineKeyboard().webApp('🍋 Play Lemur Tap', url);

      const greeting = payload.startsWith('ref_')
        ? 'A friend invited you to Lemur Tap! Tap below to start earning.'
        : 'Welcome to Lemur Tap! Tap below to start earning.';

      await ctx.reply(greeting, { reply_markup: keyboard });
    });

    bot.catch((err) => {
      this.logger.error(
        `grammY update handling error: ${err.error instanceof Error ? err.error.message : String(err.error)}`,
      );
    });
  }

  /**
   * Builds the Mini App URL for the WebApp button. A web_app button opens the
   * raw URL (Telegram does not inject start_param here), so we forward the ref
   * payload as a hash param the webapp reads at launch.
   */
  private buildWebAppUrl(payload: string): string {
    const base = this.config.get<string>('WEBAPP_URL') ?? 'https://example.com';
    if (!payload) return base;
    const sep = base.includes('#') ? '&' : '#';
    return `${base}${sep}tgWebAppStartParam=${encodeURIComponent(payload)}`;
  }
}
