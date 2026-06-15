import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ORPCError } from '@orpc/server';
import {
  type BasketTierConfig,
  type ShopBasketItem,
  type ShopCatalogResponse,
  type ShopCurrency,
  type ShopPurchaseResponse,
  type ShopSkinItem,
  type SkinConfig,
  type StarsInvoiceRequest,
  type StarsInvoiceResponse,
} from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { EconomyService } from '../economy/economy.service';
import { GameConfigService } from '../config/game-config.service';
import { BotService } from '../bot/bot.service';

/** Max retries for the optimistic-lock purchase transaction on a version race. */
const MAX_BUY_RETRIES = 3;

/**
 * Shop feature (spec/app/13). Server-authoritative purchases over coins.
 *
 * - Catalog values (basket tiers, skins, prices) come from the live GameConfig
 *   (DB-versioned) — never hardcoded; the webapp reads this catalog at runtime.
 * - Baskets are tier-cumulative: owning tier N implies owning every tier below;
 *   the active tier is the best owned one. Skins are individually owned via
 *   UserCosmetic; the free default skin (priceCoins 0) is always owned.
 * - Coin debiting + ledger writing is delegated to EconomyService (optimistic
 *   User.version lock); we never duplicate that logic.
 * - currency 'stars' on buyBasket/buySkin still rejects with STARS_NOT_AVAILABLE
 *   (the coins path is coins-only); real Stars purchases route through
 *   {@link createStarsInvoice} + the bot-driven {@link fulfillStarsInvoice}.
 */
@Injectable()
export class ShopService implements OnModuleInit {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: EconomyService,
    private readonly gameConfig: GameConfigService,
    private readonly bot: BotService,
  ) {}

  /**
   * Wires the Stars payment callbacks into the bot. The dependency is
   * one-directional (Shop -> Bot): the bot calls back here on pre_checkout /
   * successful_payment without importing ShopService, which avoids the
   * load-time import cycle (see BotService.registerStarsHandlers).
   */
  onModuleInit(): void {
    this.bot.registerStarsHandlers({
      isInvoicePayable: (payload) => this.isInvoicePayable(payload),
      fulfillStarsInvoice: (payload, chargeId) =>
        this.fulfillStarsInvoice(payload, chargeId),
    });
  }

  // ── shop.catalog ───────────────────────────────────────────────────────────

  /**
   * Live catalog enriched with the user's ownership/equip state:
   *  - baskets: owned = tier <= user.basketTier; active = tier === basketTier
   *    (a basket entry for tier 0 is the implicit default, not in config),
   *  - skins: owned via UserCosmetic (or the free default); equipped flag from
   *    User.equippedSkinId.
   */
  async catalog(userId: string): Promise<ShopCatalogResponse> {
    const cfg = this.gameConfig.get();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { basketTier: true, equippedSkinId: true },
    });
    if (!user) {
      throw AppError.unauthorized('User not found');
    }

    const owned = await this.prisma.userCosmetic.findMany({
      where: { userId },
      select: { skinId: true },
    });
    const ownedSkinIds = new Set(owned.map((c) => c.skinId));

    return {
      baskets: cfg.baskets.map((b) =>
        this.toBasketItem(b, user.basketTier),
      ),
      skins: cfg.skins.map((s) =>
        this.toSkinItem(s, ownedSkinIds, user.equippedSkinId),
      ),
      basketTier: user.basketTier,
      equippedSkinId: user.equippedSkinId,
    };
  }

  // ── shop.buyBasket ─────────────────────────────────────────────────────────

  /**
   * Buys the NEXT basket tier (tier === user.basketTier + 1) over coins:
   *  - currency 'stars' -> STARS_NOT_AVAILABLE (phase 4 stub),
   *  - unknown tier (no config entry) -> UNKNOWN_ITEM,
   *  - a tier already owned (<= current) -> ALREADY_OWNED,
   *  - a non-adjacent higher tier -> UNKNOWN_ITEM (must buy in order),
   *  - atomically debits priceCoins (-> INSUFFICIENT_COINS), writes the
   *    'basket_purchase' ledger entry, and advances User.basketTier.
   */
  async buyBasket(
    userId: string,
    tier: number,
    currency: ShopCurrency,
  ): Promise<ShopPurchaseResponse> {
    if (currency === 'stars') {
      throw this.starsNotAvailable();
    }
    const cfg = this.gameConfig.get();
    const item = cfg.baskets.find((b) => b.tier === tier);
    if (!item) {
      throw this.unknownItem(`Unknown basket tier: ${tier}`);
    }

    for (let attempt = 0; attempt < MAX_BUY_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { basketTier: true },
          });
          if (!user) {
            throw AppError.unauthorized('User not found');
          }

          if (tier <= user.basketTier) {
            throw this.alreadyOwned(`Basket tier ${tier} already owned`);
          }
          if (tier !== user.basketTier + 1) {
            // Tiers must be bought in order (cumulative ownership).
            throw this.unknownItem(
              `Basket tier ${tier} is not the next available tier`,
            );
          }

          // Debit coins (throws insufficient_coins / version-race) and write the
          // 'basket_purchase' ledger entry, all within this transaction.
          const { coins } = await this.economy.debitCoins(
            tx,
            userId,
            item.priceCoins,
            'basket_purchase',
          );

          // Advance the active tier, keyed on the prior value so a concurrent
          // buy that already advanced it loses (count === 0 -> retry).
          const bumped = await tx.user.updateMany({
            where: { id: userId, basketTier: user.basketTier },
            data: { basketTier: tier },
          });
          if (bumped.count === 0) {
            throw AppError.invalidRequest('Concurrent basket buy, please retry');
          }

          return {
            coins: Number(coins),
            basket: this.toBasketItem(item, tier),
            skin: null,
          } satisfies ShopPurchaseResponse;
        });
      } catch (err) {
        if (this.isRetryable(err) && attempt < MAX_BUY_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    throw AppError.invalidRequest('Could not complete purchase, please retry');
  }

  // ── shop.buySkin ───────────────────────────────────────────────────────────

  /**
   * Buys a cosmetic skin over coins:
   *  - currency 'stars' -> STARS_NOT_AVAILABLE (phase 4 stub),
   *  - unknown skin id -> UNKNOWN_ITEM,
   *  - already owned (incl. the free default) -> ALREADY_OWNED,
   *  - atomically debits priceCoins (-> INSUFFICIENT_COINS), writes the
   *    'skin_purchase' ledger entry, and records UserCosmetic ownership.
   */
  async buySkin(
    userId: string,
    skinId: string,
    currency: ShopCurrency,
  ): Promise<ShopPurchaseResponse> {
    if (currency === 'stars') {
      throw this.starsNotAvailable();
    }
    const cfg = this.gameConfig.get();
    const item = cfg.skins.find((s) => s.id === skinId);
    if (!item) {
      throw this.unknownItem(`Unknown skin: ${skinId}`);
    }

    for (let attempt = 0; attempt < MAX_BUY_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { equippedSkinId: true },
          });
          if (!user) {
            throw AppError.unauthorized('User not found');
          }

          // The free default skin is implicitly owned by everyone.
          if (item.priceCoins === 0 && item.priceStars === 0) {
            throw this.alreadyOwned(`Skin ${skinId} is free and already owned`);
          }

          const existing = await tx.userCosmetic.findUnique({
            where: { userId_skinId: { userId, skinId } },
            select: { id: true },
          });
          if (existing) {
            throw this.alreadyOwned(`Skin ${skinId} already owned`);
          }

          // Debit coins (throws insufficient_coins / version-race) and write the
          // 'skin_purchase' ledger entry, all within this transaction.
          const { coins } = await this.economy.debitCoins(
            tx,
            userId,
            item.priceCoins,
            'skin_purchase',
          );

          // Record ownership. The @@unique(userId, skinId) makes a racing create
          // throw P2002, surfaced as a retryable invalid_request.
          await tx.userCosmetic.create({ data: { userId, skinId } });

          const ownedIds = new Set<string>([skinId]);
          return {
            coins: Number(coins),
            basket: null,
            skin: this.toSkinItem(item, ownedIds, user.equippedSkinId),
          } satisfies ShopPurchaseResponse;
        });
      } catch (err) {
        if (this.isRetryable(err) && attempt < MAX_BUY_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    throw AppError.invalidRequest('Could not complete purchase, please retry');
  }

  // ── shop.equipSkin ─────────────────────────────────────────────────────────

  /**
   * Equips an owned skin:
   *  - unknown skin id -> UNKNOWN_ITEM,
   *  - not owned (and not the free default) -> NOT_OWNED,
   *  - sets User.equippedSkinId. No coins move (returns the live balance).
   */
  async equipSkin(
    userId: string,
    skinId: string,
  ): Promise<ShopPurchaseResponse> {
    const cfg = this.gameConfig.get();
    const item = cfg.skins.find((s) => s.id === skinId);
    if (!item) {
      throw this.unknownItem(`Unknown skin: ${skinId}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coins: true },
      });
      if (!user) {
        throw AppError.unauthorized('User not found');
      }

      const isFreeDefault = item.priceCoins === 0 && item.priceStars === 0;
      if (!isFreeDefault) {
        const owned = await tx.userCosmetic.findUnique({
          where: { userId_skinId: { userId, skinId } },
          select: { id: true },
        });
        if (!owned) {
          throw this.notOwned(`Skin ${skinId} is not owned`);
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: { equippedSkinId: skinId },
      });

      const ownedIds = new Set<string>([skinId]);
      return {
        coins: Number(user.coins),
        basket: null,
        skin: this.toSkinItem(item, ownedIds, skinId),
      } satisfies ShopPurchaseResponse;
    });
  }

  // ── shop.createStarsInvoice ────────────────────────────────────────────────

  /**
   * Creates a pending StarsInvoice and returns a Telegram invoice link the
   * webapp opens via openInvoice(). Validates exactly like the coin paths:
   *  - basket: ref is the tier (as string); must be the NEXT tier
   *    (user.basketTier + 1), exist in config, and not already owned,
   *  - skin: ref is the skinId; must exist, not be the free default, and not
   *    already owned.
   * Reuses UNKNOWN_ITEM / ALREADY_OWNED. If the bot is disabled/unconfigured
   * (no invoice link) -> STARS_NOT_AVAILABLE. No coins move.
   */
  async createStarsInvoice(
    userId: string,
    req: StarsInvoiceRequest,
  ): Promise<StarsInvoiceResponse> {
    const cfg = this.gameConfig.get();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { basketTier: true },
    });
    if (!user) {
      throw AppError.unauthorized('User not found');
    }

    let priceStars: number;
    let title: string;
    let description: string;

    if (req.kind === 'basket') {
      const tier = Number(req.ref);
      const item = cfg.baskets.find((b) => b.tier === tier);
      if (!Number.isFinite(tier) || !item) {
        throw this.unknownItem(`Unknown basket tier: ${req.ref}`);
      }
      if (tier <= user.basketTier) {
        throw this.alreadyOwned(`Basket tier ${tier} already owned`);
      }
      if (tier !== user.basketTier + 1) {
        // Tiers must be bought in order (cumulative ownership).
        throw this.unknownItem(
          `Basket tier ${tier} is not the next available tier`,
        );
      }
      priceStars = item.priceStars;
      title = `Basket tier ${tier}`;
      description = `Lemur Tap basket upgrade — tier ${tier}`;
    } else {
      const item = cfg.skins.find((s) => s.id === req.ref);
      if (!item) {
        throw this.unknownItem(`Unknown skin: ${req.ref}`);
      }
      if (item.priceCoins === 0 && item.priceStars === 0) {
        throw this.alreadyOwned(`Skin ${req.ref} is free and already owned`);
      }
      const existing = await this.prisma.userCosmetic.findUnique({
        where: { userId_skinId: { userId, skinId: req.ref } },
        select: { id: true },
      });
      if (existing) {
        throw this.alreadyOwned(`Skin ${req.ref} already owned`);
      }
      priceStars = item.priceStars;
      title = item.name;
      description = `Lemur Tap skin — ${item.name}`;
    }

    // Record the pending invoice first; its id is the Telegram payload that the
    // bot validates on pre_checkout and fulfills on successful_payment.
    const invoice = await this.prisma.starsInvoice.create({
      data: {
        userId,
        kind: req.kind,
        ref: req.ref,
        priceStars,
        status: 'pending',
      },
      select: { id: true },
    });

    // If the link can't be created (bot disabled, or a Telegram/network error),
    // park the just-created row as 'failed' before rethrowing. A surviving
    // 'pending' row would be a ghost Telegram never issued an invoice for, yet
    // isInvoicePayable() would still green-light it on pre_checkout.
    let invoiceLink: string | null;
    try {
      invoiceLink = await this.bot.createStarsInvoiceLink({
        title,
        description,
        payload: invoice.id,
        priceStars,
      });
    } catch (err) {
      await this.failInvoice(invoice.id);
      throw err;
    }
    if (!invoiceLink) {
      await this.failInvoice(invoice.id);
      throw this.starsNotAvailable();
    }

    return { invoiceLink };
  }

  // ── Stars fulfilment (bot-driven) ──────────────────────────────────────────

  /**
   * Fast pre-checkout gate for the bot: the invoice must exist and still be
   * 'pending'. A single DB lookup so it answers within Telegram's ~10s window.
   */
  async isInvoicePayable(payload: string): Promise<boolean> {
    if (!payload) return false;
    const invoice = await this.prisma.starsInvoice.findUnique({
      where: { id: payload },
      select: { status: true },
    });
    return invoice?.status === 'pending';
  }

  /**
   * Idempotently grants a paid Stars invoice. Called by the bot on
   * successful_payment; NEVER throws into the bot handler (caller wraps too).
   *
   * - Idempotency keys on telegramChargeId (UNIQUE): if the invoice is already
   *   'paid' (or this charge is already recorded) -> no-op.
   * - Missing invoice or non-'pending' status -> log + no-op.
   * - Grant by kind (basket tier advance / UserCosmetic create), tolerating the
   *   already-granted race as a no-op.
   * - Marks the invoice 'paid' with telegramChargeId + paidAt.
   * - Writes NO LedgerEntry: the ledger is the COIN audit; StarsInvoice IS the
   *   Stars audit. Stars purchases move no coins.
   */
  async fulfillStarsInvoice(
    invoiceId: string,
    telegramChargeId: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.starsInvoice.findUnique({
          where: { id: invoiceId },
        });
        if (!invoice) {
          this.logger.warn(
            `Stars fulfilment: invoice ${invoiceId} not found — ignoring.`,
          );
          return;
        }
        if (invoice.status === 'paid') {
          // Already granted (duplicate successful_payment delivery) — no-op.
          return;
        }
        if (invoice.status !== 'pending') {
          this.logger.warn(
            `Stars fulfilment: invoice ${invoiceId} status '${invoice.status}' — ignoring.`,
          );
          return;
        }

        // Did this payment actually grant something? If the item was already
        // owned by the time the payment landed (the user coin-bought it, or a
        // duplicate invoice already granted it, between createStarsInvoice and
        // successful_payment), the Stars were charged for nothing. We must NOT
        // mark such an invoice 'paid' — it gets a distinct 'no_grant' terminal
        // status so it is identifiable for a manual Stars refund.
        let granted: boolean;

        if (invoice.kind === 'basket') {
          const tier = Number(invoice.ref);
          const user = await tx.user.findUnique({
            where: { id: invoice.userId },
            select: { basketTier: true },
          });
          if (!user) {
            this.logger.warn(
              `Stars fulfilment: user ${invoice.userId} missing for invoice ${invoiceId}.`,
            );
            return;
          }
          if (tier === user.basketTier + 1) {
            const bumped = await tx.user.updateMany({
              where: { id: invoice.userId, basketTier: user.basketTier },
              data: { basketTier: tier },
            });
            // bumped.count === 1 => we advanced the tier (a real grant).
            // bumped.count === 0 => a concurrent advance won the race, so this
            // payment granted nothing (the tier was already raised elsewhere).
            granted = bumped.count === 1;
          } else {
            // Tier is no longer the next one => already owned via another path.
            granted = false;
          }
        } else {
          try {
            await tx.userCosmetic.create({
              data: { userId: invoice.userId, skinId: invoice.ref },
            });
            granted = true;
          } catch (err) {
            if ((err as { code?: string } | null)?.code === 'P2002') {
              // Already owned (acquired between invoice creation and payment).
              granted = false;
            } else {
              throw err;
            }
          }
        }

        await tx.starsInvoice.update({
          where: { id: invoiceId },
          data: {
            status: granted ? 'paid' : 'no_grant',
            telegramChargeId,
            paidAt: new Date(),
          },
        });

        if (!granted) {
          this.logger.error(
            `Stars fulfilment: invoice ${invoiceId} (kind=${invoice.kind} ref=${invoice.ref}) ` +
              `paid (charge ${telegramChargeId}) but the item was ALREADY OWNED — ` +
              `no grant applied. MANUAL STARS REFUND NEEDED for user ${invoice.userId}.`,
          );
        }
      });
    } catch (err) {
      // A unique-collision on telegramChargeId means a concurrent fulfilment
      // already recorded this charge — idempotent no-op. Anything else: log,
      // never propagate into the bot polling loop.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        this.logger.warn(
          `Stars fulfilment: charge ${telegramChargeId} already recorded for invoice ${invoiceId} — no-op.`,
        );
        return;
      }
      // Infra failure (DB outage/timeout): the transaction rolled back, so the
      // invoice stays 'pending' and the payment can be replayed/reconciled. We
      // do NOT rethrow — grammY long-polling has already consumed the update and
      // would not redeliver it, and throwing would only churn the polling loop.
      // Log loudly with the charge id so the payment can be recovered manually.
      this.logger.error(
        `Stars fulfilment FAILED for invoice ${invoiceId} (charge ${telegramChargeId}): ` +
          `${(err as Error).message}. Invoice left 'pending' for reconciliation — ` +
          `MANUAL RECOVERY may be needed.`,
      );
    }
  }

  /** Parks a pending invoice as 'failed' (no Telegram invoice was issued). */
  private async failInvoice(invoiceId: string): Promise<void> {
    try {
      await this.prisma.starsInvoice.update({
        where: { id: invoiceId },
        data: { status: 'failed' },
      });
    } catch (err) {
      this.logger.error(
        `Could not mark Stars invoice ${invoiceId} as failed: ${(err as Error).message}`,
      );
    }
  }

  // ── Item DTO builders ──────────────────────────────────────────────────────

  /** Builds a basket item DTO annotated with ownership relative to activeTier. */
  private toBasketItem(
    cfg: BasketTierConfig,
    activeTier: number,
  ): ShopBasketItem {
    return {
      tier: cfg.tier,
      durationBonusMs: cfg.durationBonusMs,
      priceCoins: cfg.priceCoins,
      priceStars: cfg.priceStars,
      owned: cfg.tier <= activeTier,
      active: cfg.tier === activeTier,
    };
  }

  /** Builds a skin item DTO annotated with ownership/equip state. */
  private toSkinItem(
    cfg: SkinConfig,
    ownedSkinIds: Set<string>,
    equippedSkinId: string | null,
  ): ShopSkinItem {
    const isFreeDefault = cfg.priceCoins === 0 && cfg.priceStars === 0;
    return {
      id: cfg.id,
      name: cfg.name,
      priceCoins: cfg.priceCoins,
      priceStars: cfg.priceStars,
      owned: isFreeDefault || ownedSkinIds.has(cfg.id),
      equipped: equippedSkinId === cfg.id,
    };
  }

  // ── Typed errors (shop-specific codes not in the shared ErrorCode enum) ──────
  //
  // The oRPC interceptor only maps AppError -> ORPCError; an ORPCError thrown
  // directly passes through unchanged. We throw these by the exact typed-error
  // name declared on the contract (data.code is the domain snake_case code).

  private starsNotAvailable(): ORPCError<'STARS_NOT_AVAILABLE', unknown> {
    return new ORPCError('STARS_NOT_AVAILABLE', {
      status: 409,
      message: 'Stars payments are not available yet',
      data: { code: 'stars_not_available' },
    });
  }

  private alreadyOwned(message: string): ORPCError<'ALREADY_OWNED', unknown> {
    return new ORPCError('ALREADY_OWNED', {
      status: 409,
      message,
      data: { code: 'already_owned' },
    });
  }

  private notOwned(message: string): ORPCError<'NOT_OWNED', unknown> {
    return new ORPCError('NOT_OWNED', {
      status: 409,
      message,
      data: { code: 'not_owned' },
    });
  }

  private unknownItem(message: string): ORPCError<'UNKNOWN_ITEM', unknown> {
    return new ORPCError('UNKNOWN_ITEM', {
      status: 400,
      message,
      data: { code: 'unknown_item' },
    });
  }

  /** True for optimistic-lock / unique-collision races worth retrying. */
  private isRetryable(err: unknown): boolean {
    if (err instanceof AppError) {
      return err.code === 'invalid_request';
    }
    const code = (err as { code?: string } | null)?.code;
    return code === 'P2002' || code === 'P2034';
  }
}
