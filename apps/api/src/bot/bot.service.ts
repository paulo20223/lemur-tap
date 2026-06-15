import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard } from 'grammy';

/**
 * Stars payment callbacks the shop registers on the bot. Declared here (not
 * imported from the shop) so BotService has NO compile-time dependency on
 * ShopService — see {@link BotService.registerStarsHandlers}.
 */
export interface StarsPaymentHandlers {
  /** Pre-checkout gate: is this invoice payload still payable? */
  isInvoicePayable(payload: string): Promise<boolean>;
  /** successful_payment: idempotently grant the paid invoice. Never throws. */
  fulfillStarsInvoice(payload: string, telegramChargeId: string): Promise<void>;
}

/**
 * BotService — minimal grammY Telegram bot for Lemur Tap (spec/app/02, 09).
 *
 * Responsibilities:
 *  - `/start` command replying with a WebApp button (`web_app`) opening WEBAPP_URL.
 *  - Referral deep links: `https://t.me/<bot>?start=ref_<code>` → the `ref_<code>`
 *    payload arrives as `ctx.match`; it is forwarded into the Mini App URL so the
 *    webapp can pass it back to `POST /auth/telegram` (referrer is bound there).
 *  - Telegram Stars payments: hands the shop an invoice link
 *    ({@link createStarsInvoiceLink}) and, on the bot side, gates pre_checkout
 *    and fulfils on successful_payment (both delegated to ShopService).
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
  private starsHandlers: StarsPaymentHandlers | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Registers the Stars payment callbacks (shop side). Called once by
   * ShopService.onModuleInit.
   *
   * Why a one-way registration instead of injecting ShopService here: a
   * Bot<->Shop injection cycle has both services name each other as constructor
   * param types, so `emitDecoratorMetadata` emits an eager `design:paramtypes`
   * reference to each class at decoration time. Under a circular `require` that
   * reference hits the temporal dead zone and crashes module load with
   * "Cannot access 'ShopService' before initialization" — even with forwardRef
   * (which only fixes Nest's DI resolution, not the metadata emission). Keeping
   * the dependency one-directional (Shop -> Bot) removes the value cycle.
   */
  registerStarsHandlers(handlers: StarsPaymentHandlers): void {
    this.starsHandlers = handlers;
  }

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

    // ── Telegram Stars: pre-checkout gate ────────────────────────────────────
    // Telegram demands an answer within ~10s; keep this to one fast DB lookup.
    bot.on('pre_checkout_query', async (ctx) => {
      const payload = ctx.preCheckoutQuery.invoice_payload;
      try {
        const payable =
          (await this.starsHandlers?.isInvoicePayable(payload)) ?? false;
        if (payable) {
          await ctx.answerPreCheckoutQuery(true);
        } else {
          await ctx.answerPreCheckoutQuery(false, {
            error_message: 'This order is no longer available.',
          });
        }
      } catch (err) {
        this.logger.error(
          `pre_checkout_query handling failed (payload=${payload}): ${(err as Error).message}`,
        );
        try {
          await ctx.answerPreCheckoutQuery(false, {
            error_message: 'Payment could not be processed.',
          });
        } catch {
          /* best-effort: nothing more we can do within the window */
        }
      }
    });

    // ── Telegram Stars: successful payment -> idempotent grant ───────────────
    // fulfillStarsInvoice is its own error boundary (logs, never throws), so no
    // second try/catch here; bot.catch is the final net for anything unexpected.
    bot.on('message:successful_payment', async (ctx) => {
      const payment = ctx.message.successful_payment;
      if (!this.starsHandlers) {
        this.logger.error(
          `successful_payment with no Stars handler registered (payload=${payment.invoice_payload}) — payment unprocessed.`,
        );
        return;
      }
      await this.starsHandlers.fulfillStarsInvoice(
        payment.invoice_payload,
        payment.telegram_payment_charge_id,
      );
    });

    bot.catch((err) => {
      this.logger.error(
        `grammY update handling error: ${err.error instanceof Error ? err.error.message : String(err.error)}`,
      );
    });
  }

  /**
   * Creates a Telegram Stars invoice link (currency 'XTR', empty provider
   * token). Returns null if the bot is disabled (no token configured), which
   * the shop maps to STARS_NOT_AVAILABLE.
   *
   * @param payload the StarsInvoice id, echoed back on pre_checkout/success.
   * @param priceStars whole Stars amount (XTR has no sub-units).
   */
  async createStarsInvoiceLink({
    title,
    description,
    payload,
    priceStars,
  }: {
    title: string;
    description: string;
    payload: string;
    priceStars: number;
  }): Promise<string | null> {
    if (!this.bot) {
      return null;
    }
    return this.bot.api.createInvoiceLink(
      title,
      description,
      payload,
      '', // provider_token: empty for Telegram Stars
      'XTR',
      [{ label: title, amount: priceStars }],
    );
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
