import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '@lemur/shared';
import { CouponService } from './coupon.service';

/**
 * Service-level coverage for the start() round-handover behavior (spec/app/06):
 * a still-running active session (e.g. a round orphaned by a server restart /
 * dropped connection) is abandoned and its session-cost energy refunded, so the
 * new round can start immediately instead of hard-blocking with SESSION_ACTIVE.
 *
 * The Prisma transaction and EconomyService are mocked at the DI seam; the
 * assertions exercise the real service arithmetic/branching, not the mocks.
 */

const cfg = DEFAULT_GAME_CONFIG;
const NOW = 1_700_000_000_000;

type TxStubs = {
  expireResult: { count: number };
  abandonResult: { count: number };
  energy: number;
  maxEnergy: number;
};

function makeService(stubs: TxStubs) {
  const updateMany = vi
    .fn()
    // 1st call: lazily expire timed-out active sessions.
    .mockResolvedValueOnce(stubs.expireResult)
    // 2nd call: abandon the still-running active session (the new behavior).
    .mockResolvedValueOnce(stubs.abandonResult);

  const userUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

  const tx = {
    couponGameSession: {
      updateMany,
      create: vi.fn().mockResolvedValue({ id: 'new-session' }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'u1',
        energy: stubs.energy,
        energyUpdatedAt: BigInt(NOW),
        version: 1,
        basketTier: 0,
      }),
      updateMany: userUpdateMany,
    },
  };

  const prisma = {
    $transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
  };

  const economy = {
    config: () => cfg,
    getEffectiveStats: vi.fn().mockResolvedValue({ couponMult: 1 }),
    recomputeEnergy: vi.fn().mockResolvedValue({
      energy: stubs.energy,
      energyUpdatedAt: NOW,
      maxEnergy: stubs.maxEnergy,
    }),
  };

  const service = new CouponService(
    prisma as never,
    economy as never,
  );

  vi.spyOn(Date, 'now').mockReturnValue(NOW);

  return { service, updateMany, userUpdateMany };
}

describe('CouponService.start — orphaned-round handover', () => {
  it('abandons a still-running active round and refunds its session cost', async () => {
    // Energy alone (100) is below the cost (500); only the refund of the
    // abandoned round makes the new round affordable.
    const { service, updateMany, userUpdateMany } = makeService({
      expireResult: { count: 0 },
      abandonResult: { count: 1 },
      energy: 100,
      maxEnergy: 5000,
    });

    await expect(service.start('u1')).resolves.toMatchObject({
      sessionId: 'new-session',
    });

    // The still-active round was abandoned (not left blocking).
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ status: 'abandoned' }),
      }),
    );

    // Net energy = refund(500) applied then new cost(500) debited: 100 + 500 - 500.
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ energy: 100 }),
      }),
    );
  });

  it('nets a single debit when no stale round exists', async () => {
    const { service, userUpdateMany } = makeService({
      expireResult: { count: 0 },
      abandonResult: { count: 0 },
      energy: 1000,
      maxEnergy: 5000,
    });

    await service.start('u1');

    // No refund: just the new round's cost debited (1000 - 500).
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          energy: 1000 - cfg.couponSessionCost,
        }),
      }),
    );
  });
});
