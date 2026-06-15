import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORPCError } from '@orpc/server';
import { DEFAULT_GAME_CONFIG } from '@lemur/shared';
import { ShopService } from './shop.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { EconomyService } from '../economy/economy.service';
import type { GameConfigService } from '../config/game-config.service';
import type { BotService } from '../bot/bot.service';

/**
 * ShopService Stars-payment coverage (spec/app/13):
 *  - createStarsInvoice validation mirrors the coin path (unknown / owned /
 *    next-tier) and surfaces STARS_NOT_AVAILABLE when the bot is disabled,
 *  - fulfillStarsInvoice grants correctly and is idempotent on a duplicated
 *    charge / already-paid invoice (no double grant, never throws).
 *
 * Prisma is hand-mocked; $transaction runs its callback against a `tx` we also
 * mock so the grant logic is exercised without a DB.
 */

type Invoice = {
  id: string;
  userId: string;
  kind: string;
  ref: string;
  priceStars: number;
  status: string;
  telegramChargeId: string | null;
  paidAt: Date | null;
};

function makeService() {
  const userRow = { id: 'u1', basketTier: 0 };
  const invoices = new Map<string, Invoice>();
  const cosmetics = new Set<string>(); // `${userId}:${skinId}`

  let invoiceSeq = 0;

  const tx = {
    user: {
      findUnique: vi.fn(async () => ({ basketTier: userRow.basketTier })),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; basketTier?: number };
          data: { basketTier: number };
        }) => {
          if (
            where.basketTier !== undefined &&
            where.basketTier !== userRow.basketTier
          ) {
            return { count: 0 };
          }
          userRow.basketTier = data.basketTier;
          return { count: 1 };
        },
      ),
    },
    userCosmetic: {
      create: vi.fn(async ({ data }: { data: { userId: string; skinId: string } }) => {
        const key = `${data.userId}:${data.skinId}`;
        if (cosmetics.has(key)) {
          const err = new Error('Unique constraint') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        cosmetics.add(key);
        return { id: 'c1', ...data };
      }),
    },
    starsInvoice: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        invoices.get(where.id) ?? null,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Invoice>;
        }) => {
          const inv = invoices.get(where.id)!;
          Object.assign(inv, data);
          return inv;
        },
      ),
    },
  };

  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({ basketTier: userRow.basketTier })),
    },
    userCosmetic: {
      findUnique: vi.fn(async ({ where }: { where: { userId_skinId: { userId: string; skinId: string } } }) => {
        const { userId, skinId } = where.userId_skinId;
        return cosmetics.has(`${userId}:${skinId}`) ? { id: 'c1' } : null;
      }),
    },
    starsInvoice: {
      create: vi.fn(async ({ data }: { data: Omit<Invoice, 'id' | 'telegramChargeId' | 'paidAt'> }) => {
        const id = `inv${++invoiceSeq}`;
        const inv: Invoice = {
          id,
          telegramChargeId: null,
          paidAt: null,
          ...data,
        };
        invoices.set(id, inv);
        return { id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        invoices.get(where.id) ?? null,
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<Invoice> }) => {
          const inv = invoices.get(where.id)!;
          Object.assign(inv, data);
          return inv;
        },
      ),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  const economy = {} as unknown as EconomyService;
  const gameConfig = {
    get: () => DEFAULT_GAME_CONFIG,
  } as unknown as GameConfigService;
  const bot = {
    createStarsInvoiceLink: vi.fn(async () => 'https://t.me/invoice/abc'),
  } as unknown as BotService;

  const service = new ShopService(prisma, economy, gameConfig, bot);
  return { service, prisma, bot, invoices, cosmetics, userRow, tx };
}

describe('ShopService.createStarsInvoice — validation', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('creates a pending invoice for the next basket tier and returns the link', async () => {
    const res = await ctx.service.createStarsInvoice('u1', {
      kind: 'basket',
      ref: '1',
    });
    expect(res.invoiceLink).toBe('https://t.me/invoice/abc');

    // Price is whatever the live config sets for tier 1 (immune to retuning):
    // we assert the service passes that exact value through, not a fixed number.
    const tier1Stars = DEFAULT_GAME_CONFIG.baskets.find((b) => b.tier === 1)!
      .priceStars;
    const inv = [...ctx.invoices.values()][0]!;
    expect(inv).toMatchObject({
      userId: 'u1',
      kind: 'basket',
      ref: '1',
      priceStars: tier1Stars,
      status: 'pending',
    });
    expect(ctx.bot.createStarsInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({ payload: inv.id, priceStars: tier1Stars }),
    );
  });

  it('rejects a non-next basket tier with UNKNOWN_ITEM (must buy in order)', async () => {
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'basket', ref: '3' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ITEM' });
  });

  it('rejects an already-owned basket tier with ALREADY_OWNED', async () => {
    ctx.userRow.basketTier = 2;
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'basket', ref: '1' }),
    ).rejects.toMatchObject({ code: 'ALREADY_OWNED' });
  });

  it('rejects an unknown basket tier with UNKNOWN_ITEM', async () => {
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'basket', ref: '99' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ITEM' });
  });

  it('rejects an unknown skin with UNKNOWN_ITEM', async () => {
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'skin', ref: 'nope' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ITEM' });
  });

  it('rejects the free default skin with ALREADY_OWNED', async () => {
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'skin', ref: 'classic' }),
    ).rejects.toMatchObject({ code: 'ALREADY_OWNED' });
  });

  it('rejects an owned skin with ALREADY_OWNED', async () => {
    ctx.cosmetics.add('u1:dealer');
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'skin', ref: 'dealer' }),
    ).rejects.toMatchObject({ code: 'ALREADY_OWNED' });
  });

  it('creates a pending invoice for a buyable skin', async () => {
    const res = await ctx.service.createStarsInvoice('u1', {
      kind: 'skin',
      ref: 'dealer',
    });
    expect(res.invoiceLink).toBe('https://t.me/invoice/abc');
    const dealerStars = DEFAULT_GAME_CONFIG.skins.find((s) => s.id === 'dealer')!
      .priceStars;
    expect([...ctx.invoices.values()][0]).toMatchObject({
      kind: 'skin',
      ref: 'dealer',
      priceStars: dealerStars,
      status: 'pending',
    });
  });

  it('throws STARS_NOT_AVAILABLE when the bot returns no link (disabled)', async () => {
    (ctx.bot.createStarsInvoiceLink as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null,
    );
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'basket', ref: '1' }),
    ).rejects.toBeInstanceOf(ORPCError);
    await expect(
      ctx.service.createStarsInvoice('u1', { kind: 'basket', ref: '1' }),
    ).resolves.toBeDefined(); // (control: link present -> ok)
  });
});

describe('ShopService.fulfillStarsInvoice — grant + idempotency', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('advances the basket tier and marks the invoice paid', async () => {
    ctx.invoices.set('inv1', {
      id: 'inv1',
      userId: 'u1',
      kind: 'basket',
      ref: '1',
      priceStars: 70,
      status: 'pending',
      telegramChargeId: null,
      paidAt: null,
    });

    await ctx.service.fulfillStarsInvoice('inv1', 'charge_1');

    expect(ctx.userRow.basketTier).toBe(1);
    const inv = ctx.invoices.get('inv1')!;
    expect(inv.status).toBe('paid');
    expect(inv.telegramChargeId).toBe('charge_1');
    expect(inv.paidAt).toBeInstanceOf(Date);
  });

  it('is a no-op on a duplicate successful_payment (already paid -> no re-grant)', async () => {
    ctx.invoices.set('inv1', {
      id: 'inv1',
      userId: 'u1',
      kind: 'basket',
      ref: '1',
      priceStars: 70,
      status: 'pending',
      telegramChargeId: null,
      paidAt: null,
    });

    await ctx.service.fulfillStarsInvoice('inv1', 'charge_1');
    expect(ctx.userRow.basketTier).toBe(1);

    // Second delivery of the same charge: invoice already 'paid' -> no-op.
    await ctx.service.fulfillStarsInvoice('inv1', 'charge_1');
    expect(ctx.userRow.basketTier).toBe(1);
    expect(ctx.tx.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('grants a skin via UserCosmetic and marks paid', async () => {
    ctx.invoices.set('inv2', {
      id: 'inv2',
      userId: 'u1',
      kind: 'skin',
      ref: 'dealer',
      priceStars: 100,
      status: 'pending',
      telegramChargeId: null,
      paidAt: null,
    });

    await ctx.service.fulfillStarsInvoice('inv2', 'charge_2');

    expect(ctx.cosmetics.has('u1:dealer')).toBe(true);
    expect(ctx.invoices.get('inv2')!.status).toBe('paid');
  });

  it('marks an already-owned skin (P2002) as no_grant (refund-needed), not paid', async () => {
    // TOCTOU: the user acquired the skin between invoice creation and payment,
    // so the Stars were charged for nothing. The invoice must not read 'paid'.
    ctx.cosmetics.add('u1:dealer');
    ctx.invoices.set('inv2', {
      id: 'inv2',
      userId: 'u1',
      kind: 'skin',
      ref: 'dealer',
      priceStars: 100,
      status: 'pending',
      telegramChargeId: null,
      paidAt: null,
    });

    await ctx.service.fulfillStarsInvoice('inv2', 'charge_2');
    expect(ctx.invoices.get('inv2')!.status).toBe('no_grant');
    expect(ctx.invoices.get('inv2')!.telegramChargeId).toBe('charge_2');
  });

  it('marks an already-advanced basket tier as no_grant (refund-needed)', async () => {
    // The user coin-bought the tier after the invoice was created.
    ctx.userRow.basketTier = 1;
    ctx.invoices.set('inv3', {
      id: 'inv3',
      userId: 'u1',
      kind: 'basket',
      ref: '1',
      priceStars: 70,
      status: 'pending',
      telegramChargeId: null,
      paidAt: null,
    });

    await ctx.service.fulfillStarsInvoice('inv3', 'charge_3');
    expect(ctx.userRow.basketTier).toBe(1); // unchanged
    expect(ctx.invoices.get('inv3')!.status).toBe('no_grant');
  });

  it('no-ops (never throws) when the invoice is missing', async () => {
    await expect(
      ctx.service.fulfillStarsInvoice('ghost', 'charge_x'),
    ).resolves.toBeUndefined();
  });
});
