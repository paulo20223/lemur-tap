import { Injectable } from '@nestjs/common';
import type {
  LeaderboardEntryDto,
  LeaderboardResponse,
} from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';

/** Default page size of the public top list; capped by the contract at 100. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Leaderboard service — global ranking by current coin balance.
 *
 * The ordering is deterministic: coins desc, then earlier joiner first
 * (createdAt asc), then id asc as a final tiebreak. The viewer's own rank is
 * computed by counting everyone strictly ahead of them in that exact ordering,
 * so the pinned "you" row is consistent with the listed positions even on ties.
 *
 * No accrual or mutation happens here; this is a pure read. Money is stored as
 * BIGINT and converted to `number` before it leaves the service (game balances
 * stay within JS-safe range).
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getTop(
    userId: string,
    query: { limit?: number },
  ): Promise<LeaderboardResponse> {
    const limit = this.normalizeLimit(query.limit);

    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        isPremium: true,
        coins: true,
        createdAt: true,
      },
    });
    if (!viewer) {
      throw AppError.unauthorized('User not found');
    }

    const [rows, total, ahead] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ coins: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true, username: true, isPremium: true, coins: true },
      }),
      this.prisma.user.count(),
      this.countAhead(viewer),
    ]);

    const top: LeaderboardEntryDto[] = rows.map((row, i) => ({
      rank: i + 1,
      userId: row.id,
      username: row.username,
      isPremium: row.isPremium,
      coins: Number(row.coins),
    }));

    const inTop = top.find((e) => e.userId === viewer.id);
    const me: LeaderboardEntryDto = inTop ?? {
      rank: ahead + 1,
      userId: viewer.id,
      username: viewer.username,
      isPremium: viewer.isPremium,
      coins: Number(viewer.coins),
    };

    return { top, me, total };
  }

  /**
   * Counts players strictly ahead of the viewer in the (coins desc, createdAt
   * asc, id asc) ordering — i.e. the keyset predicate of "ranks above me".
   */
  private countAhead(viewer: {
    id: string;
    coins: bigint;
    createdAt: Date;
  }): Promise<number> {
    return this.prisma.user.count({
      where: {
        OR: [
          { coins: { gt: viewer.coins } },
          { coins: viewer.coins, createdAt: { lt: viewer.createdAt } },
          {
            coins: viewer.coins,
            createdAt: viewer.createdAt,
            id: { lt: viewer.id },
          },
        ],
      },
    });
  }

  private normalizeLimit(raw?: number): number {
    if (raw === undefined || Number.isNaN(raw)) {
      return DEFAULT_LIMIT;
    }
    const n = Math.floor(raw);
    if (n <= 0) {
      return DEFAULT_LIMIT;
    }
    return Math.min(n, MAX_LIMIT);
  }
}
