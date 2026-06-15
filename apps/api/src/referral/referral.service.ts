import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ReferralEarningsDto,
  ReferralItemDto,
  ReferralResponse,
} from '@lemur/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import type { PrismaTx } from '../common/prisma/prisma-tx';
import { AppError } from '../common/errors/app-error';
import { EconomyService } from '../economy/economy.service';

/** Hard cap on a single referrals page to bound query cost. */
const MAX_PAGE_LIMIT = 50;
const DEFAULT_PAGE_LIMIT = 20;

/**
 * Referral feature service.
 *
 * Primary responsibility is the GET /referral report (code, deep link,
 * earnings aggregated from LedgerEntry(type='referral') by refSource, and a
 * paginated list of referees).
 *
 * It ALSO exposes idempotent bonus-granting helpers (join + premium) that
 * AuthModule imports and calls during POST /auth/telegram. Minting goes through
 * EconomyService.creditCoins so balances/ledger stay consistent with the rest
 * of the economy; the passive (10%) is minted by EconomyService.creditEarning
 * on the referee's coupon income (NOT here). See spec/app/09.
 */
@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: EconomyService,
    private readonly config: ConfigService,
  ) {}

  // ── Report (GET /referral) ────────────────────────────────────────────────

  async getReport(
    userId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<ReferralResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) {
      throw AppError.unauthorized('User not found');
    }

    const limit = this.normalizeLimit(query.limit);
    const [earnings, page] = await Promise.all([
      this.aggregateEarnings(userId),
      this.listReferrals(userId, limit, query.cursor),
    ]);

    return {
      code: user.referralCode,
      link: this.buildDeepLink(user.referralCode),
      earnings,
      referrals: page.items,
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Aggregates referral earnings split by refSource (join / premium / passive).
   * Source of truth is the immutable ledger, so the report always reconciles.
   */
  private async aggregateEarnings(userId: string): Promise<ReferralEarningsDto> {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['refSource'],
      where: { userId, type: 'referral' },
      _sum: { amount: true },
    });

    const earnings: ReferralEarningsDto = {
      join: 0,
      premium: 0,
      passive: 0,
      total: 0,
    };
    for (const row of grouped) {
      const value = Number(row._sum.amount ?? 0n);
      switch (row.refSource) {
        case 'join':
          earnings.join += value;
          break;
        case 'premium':
          earnings.premium += value;
          break;
        case 'passive':
          earnings.passive += value;
          break;
        default:
          break;
      }
    }
    earnings.total = earnings.join + earnings.premium + earnings.passive;
    return earnings;
  }

  /**
   * Cursor-paginated list of referees (newest first). The cursor is the last
   * Referral.id of the previous page (keyset pagination on the stable
   * (createdAt desc, id desc) order via the @@index([referrerId, createdAt])).
   */
  private async listReferrals(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: ReferralItemDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        referee: {
          select: { id: true, username: true, isPremium: true },
        },
      },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: ReferralItemDto[] = pageRows.map((row) => ({
      userId: row.referee.id,
      username: row.referee.username,
      isPremium: row.referee.isPremium,
      joinedAt: row.createdAt.toISOString(),
    }));

    const last = pageRows[pageRows.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  private normalizeLimit(raw?: number): number {
    if (raw === undefined || Number.isNaN(raw)) {
      return DEFAULT_PAGE_LIMIT;
    }
    const n = Math.floor(raw);
    if (n <= 0) {
      return DEFAULT_PAGE_LIMIT;
    }
    return Math.min(n, MAX_PAGE_LIMIT);
  }

  /** Builds the Telegram Mini App deep link `startapp=ref_<code>`. */
  buildDeepLink(code: string): string {
    const bot = this.config.get<string>('TELEGRAM_BOT_USERNAME') ?? 'bot';
    const app = this.config.get<string>('TELEGRAM_APP_NAME');
    const base = app ? `https://t.me/${bot}/${app}` : `https://t.me/${bot}`;
    return `${base}?startapp=ref_${code}`;
  }

  // ── Bonus granting (called by AuthModule within POST /auth/telegram) ───────

  /**
   * Grants the one-off JOIN bonus once the referee has reached minimal activity
   * (anti-sybil). Idempotent via Referral.joinBonusGranted; respects the
   * per-referrer daily/total rewarded-referral caps. Must be called inside an
   * interactive transaction so the flag flip and both credits commit atomically.
   *
   * Returns the coins minted to {referrer, referee} (0/0 if not granted yet).
   */
  async grantJoinBonus(
    tx: PrismaTx,
    refereeId: string,
  ): Promise<{ referrer: number; referee: number }> {
    const referral = await tx.referral.findUnique({
      where: { refereeId },
      select: { id: true, referrerId: true, joinBonusGranted: true },
    });
    if (!referral || referral.joinBonusGranted) {
      return { referrer: 0, referee: 0 };
    }

    const cfg = this.economy.config();

    // Anti-sybil: referee must have produced minimal real activity first.
    if (!(await this.hasMinActivity(tx, refereeId))) {
      return { referrer: 0, referee: 0 };
    }

    // Per-referrer rewarded-referral caps (total + per UTC day).
    if (!(await this.withinRewardCaps(tx, referral.referrerId, cfg))) {
      return { referrer: 0, referee: 0 };
    }

    // Flip the idempotency flag first; only one concurrent caller wins.
    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, joinBonusGranted: false },
      data: { joinBonusGranted: true },
    });
    if (claimed.count === 0) {
      return { referrer: 0, referee: 0 };
    }

    await this.economy.creditCoins(
      tx,
      referral.referrerId,
      cfg.referralJoinBonusReferrer,
      'referral',
      referral.id,
      'join',
    );
    await this.economy.creditCoins(
      tx,
      refereeId,
      cfg.referralJoinBonusReferee,
      'referral',
      referral.id,
      'join',
    );

    return {
      referrer: cfg.referralJoinBonusReferrer,
      referee: cfg.referralJoinBonusReferee,
    };
  }

  /**
   * Grants the one-off PREMIUM bonus when the referee is Telegram Premium and
   * bound to a referrer. Stacks on top of the join bonus. Idempotent via
   * Referral.premiumBonusGranted (re-toggling Premium never re-grants). Call
   * inside an interactive transaction. Returns coins minted to each party.
   */
  async grantPremiumBonus(
    tx: PrismaTx,
    refereeId: string,
  ): Promise<{ referrer: number; referee: number }> {
    const referral = await tx.referral.findUnique({
      where: { refereeId },
      select: { id: true, referrerId: true, premiumBonusGranted: true },
    });
    if (!referral || referral.premiumBonusGranted) {
      return { referrer: 0, referee: 0 };
    }

    const cfg = this.economy.config();

    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, premiumBonusGranted: false },
      data: { premiumBonusGranted: true },
    });
    if (claimed.count === 0) {
      return { referrer: 0, referee: 0 };
    }

    await this.economy.creditCoins(
      tx,
      referral.referrerId,
      cfg.referralPremiumBonusReferrer,
      'referral',
      referral.id,
      'premium',
    );
    await this.economy.creditCoins(
      tx,
      refereeId,
      cfg.referralPremiumBonusReferee,
      'referral',
      referral.id,
      'premium',
    );

    return {
      referrer: cfg.referralPremiumBonusReferrer,
      referee: cfg.referralPremiumBonusReferee,
    };
  }

  /**
   * Minimal-activity gate: the referee must have completed at least one finished
   * coupon session (a real played round). Tap is gone, so a finished coupon
   * round is the sole activity signal.
   */
  private async hasMinActivity(
    tx: PrismaTx,
    refereeId: string,
  ): Promise<boolean> {
    const finishedCoupon = await tx.couponGameSession.count({
      where: { userId: refereeId, status: 'finished' },
    });
    return finishedCoupon > 0;
  }

  /**
   * Checks the per-referrer rewarded-referral caps. A "rewarded" referral is a
   * Referral row that has its join bonus granted; we count those for total and
   * today's (UTC) window against config caps.
   */
  private async withinRewardCaps(
    tx: PrismaTx,
    referrerId: string,
    cfg: { referralTotalCap: number; referralDailyCap: number },
  ): Promise<boolean> {
    const total = await tx.referral.count({
      where: { referrerId, joinBonusGranted: true },
    });
    if (total >= cfg.referralTotalCap) {
      return false;
    }

    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);
    const today = await tx.referral.count({
      where: {
        referrerId,
        joinBonusGranted: true,
        createdAt: { gte: startOfUtcDay },
      },
    });
    return today < cfg.referralDailyCap;
  }
}
