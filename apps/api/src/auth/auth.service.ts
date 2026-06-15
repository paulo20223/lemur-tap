import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  type AuthTelegramResponse,
  type UserProfileDto,
  type GameConfig,
} from '@lemur/shared';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { PrismaTx } from '../common/prisma/prisma-tx';
import { AppError } from '../common/errors/app-error';
import { GameConfigService } from '../config/game-config.service';
import { EconomyService } from '../economy/economy.service';
import type { JwtPayload } from '../common/auth/auth-user';
import {
  verifyInitData,
  parseReferralCode,
  resolveStartParam,
  InitDataError,
  type VerifiedInitData,
} from './init-data';
import { generateReferralCode } from './referral-code';

const UNIQUE_VIOLATION = 'P2002';

/**
 * AuthModule core. Validates Telegram WebApp initData, upserts the User,
 * binds the referrer on first launch, grants idempotent referral/premium
 * bonuses, and issues a short-lived session JWT. Server-authoritative per
 * spec/app/02, 09, 11.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gameConfig: GameConfigService,
    private readonly economy: EconomyService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** POST /auth/telegram — validate initData → { jwt, profile }. */
  async authenticate(
    initData: string,
    clientStartParam?: string,
  ): Promise<AuthTelegramResponse> {
    const cfg = this.gameConfig.get();
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      // Misconfiguration — fail closed rather than accept unverifiable data.
      this.logger.error('TELEGRAM_BOT_TOKEN is not configured');
      throw AppError.unauthorized('Auth is not configured');
    }

    let verified: VerifiedInitData;
    try {
      verified = verifyInitData(initData, botToken, cfg.authDateMaxAgeMs);
    } catch (err) {
      if (err instanceof InitDataError) {
        throw AppError.unauthorized(`Invalid initData: ${err.message}`);
      }
      throw AppError.unauthorized('Invalid initData');
    }

    // 1) Upsert the user (generates a unique referralCode on create).
    const { user, isNew } = await this.upsertUser(verified);

    // 2) Bind referrer on first launch; grant premium / activity-gated join.
    //    Prefer the signed start_param, fall back to the client launch param
    //    (Telegram does not embed startapp in signed initData on every client).
    const startParam = resolveStartParam(verified.startParam, clientStartParam);
    await this.handleReferral(user, verified, startParam, isNew, cfg);

    // 3) Build profile (with lazily recomputed energy) and sign the JWT.
    const profile = await this.buildProfile(user.id);
    const jwt = await this.signJwt(user.id, cfg);
    return { jwt, profile };
  }

  // ── User upsert ─────────────────────────────────────────────────────────

  /**
   * Finds or creates the User by telegramId. On create, assigns a unique
   * base62 referralCode (retrying on the rare collision). On an existing user
   * refreshes username / isPremium (the latter drives a possible premium bonus).
   */
  private async upsertUser(
    v: VerifiedInitData,
  ): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: v.telegramId },
    });
    if (existing) {
      const username = v.user.username ?? null;
      // Only touch the row when something visible changed.
      if (existing.username !== username || existing.isPremium !== v.isPremium) {
        const updated = await this.prisma.user.update({
          where: { id: existing.id },
          data: { username, isPremium: v.isPremium },
        });
        return { user: updated, isNew: false };
      }
      return { user: existing, isNew: false };
    }

    // Create with a unique referral code; retry a few times on collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.user.create({
          data: {
            telegramId: v.telegramId,
            username: v.user.username ?? null,
            isPremium: v.isPremium,
            referralCode: generateReferralCode(),
          },
        });
        return { user: created, isNew: true };
      } catch (err) {
        if (this.isUniqueViolation(err)) {
          // Either referralCode collided (retry) or a concurrent first-launch
          // created the same telegramId (re-fetch and treat as existing).
          const concurrent = await this.prisma.user.findUnique({
            where: { telegramId: v.telegramId },
          });
          if (concurrent) {
            return { user: concurrent, isNew: false };
          }
          continue; // referralCode collision — try a fresh code.
        }
        throw err;
      }
    }
    throw AppError.invalidRequest('Could not allocate a referral code');
  }

  // ── Referral binding & bonuses ────────────────────────────────────────────

  /**
   * Binds the referrer on first launch and reconciles idempotent bonuses:
   *  - On bind: create Referral(referrerId, refereeId) (self-invite & double
   *    binding blocked by DB constraints).
   *  - Join bonus: granted once, only after the referee reaches minimal
   *    activity (anti-sybil) and within referrer daily/total caps.
   *  - Premium bonus: granted once when initData.is_premium is true and the
   *    referee is bound; stacks on top of the join bonus.
   */
  private async handleReferral(
    user: User,
    v: VerifiedInitData,
    startParam: string | null,
    isNew: boolean,
    cfg: GameConfig,
  ): Promise<void> {
    // Bind only on first launch (referrer is fixed once and never changes).
    if (isNew && !user.referrerId) {
      const code = parseReferralCode(startParam);
      if (code && code !== user.referralCode) {
        await this.bindReferrer(user, code);
      }
    }

    // Re-read the referral (it may have just been created or pre-existed).
    const referral = await this.prisma.referral.findUnique({
      where: { refereeId: user.id },
    });
    if (!referral) {
      return;
    }

    // Join bonus — activity-gated, granted once.
    if (!referral.joinBonusGranted) {
      await this.tryGrantJoinBonus(referral.id, referral.referrerId, user.id, cfg);
    }

    // Premium bonus — granted once when the referee is currently Premium.
    if (v.isPremium && !referral.premiumBonusGranted) {
      await this.tryGrantPremiumBonus(
        referral.id,
        referral.referrerId,
        user.id,
        cfg,
      );
    }
  }

  /** Creates the Referral row, resolving the referrer code. Idempotent/race-safe. */
  private async bindReferrer(referee: User, code: string): Promise<void> {
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!referrer || referrer.id === referee.id) {
      // Unknown code or self-invite — silently ignore (no hard error on auth).
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.referral.create({
          data: { referrerId: referrer.id, refereeId: referee.id },
        });
        // Denormalized copy on the user row (set once).
        await tx.user.update({
          where: { id: referee.id },
          data: { referrerId: referrer.id },
        });
      });
    } catch (err) {
      // unique(refereeId) race or self-invite CHECK — both safe to ignore.
      if (this.isUniqueViolation(err)) {
        return;
      }
      throw err;
    }
  }

  /**
   * Grants the one-off join bonus once the referee shows minimal activity and
   * the referrer is within daily/total caps. Flag flip + ledger writes are
   * atomic; the flag guarantees single emission.
   */
  private async tryGrantJoinBonus(
    referralId: string,
    referrerId: string,
    refereeId: string,
    cfg: GameConfig,
  ): Promise<void> {
    const active = await this.hasMinActivity(refereeId);
    if (!active) {
      return; // Defer until the referee actually plays.
    }
    if (!(await this.withinReferralCaps(referrerId, cfg))) {
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Atomically flip the flag; bail if another request won the race.
        const claimed = await tx.referral.updateMany({
          where: { id: referralId, joinBonusGranted: false },
          data: { joinBonusGranted: true },
        });
        if (claimed.count === 0) {
          return;
        }
        await this.creditReferral(
          tx,
          referrerId,
          cfg.referralJoinBonusReferrer,
          'join',
          referralId,
        );
        await this.creditReferral(
          tx,
          refereeId,
          cfg.referralJoinBonusReferee,
          'join',
          referralId,
        );
      });
    } catch (err) {
      this.logger.error(`Join bonus failed: ${(err as Error).message}`);
    }
  }

  /**
   * Grants the one-off Telegram-Premium bonus once (stacks on the join bonus).
   * Subject to the same per-referrer caps as the join bonus.
   */
  private async tryGrantPremiumBonus(
    referralId: string,
    referrerId: string,
    refereeId: string,
    cfg: GameConfig,
  ): Promise<void> {
    if (!(await this.withinReferralCaps(referrerId, cfg))) {
      return;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.referral.updateMany({
          where: { id: referralId, premiumBonusGranted: false },
          data: { premiumBonusGranted: true },
        });
        if (claimed.count === 0) {
          return;
        }
        await this.creditReferral(
          tx,
          referrerId,
          cfg.referralPremiumBonusReferrer,
          'premium',
          referralId,
        );
        await this.creditReferral(
          tx,
          refereeId,
          cfg.referralPremiumBonusReferee,
          'premium',
          referralId,
        );
      });
    } catch (err) {
      this.logger.error(`Premium bonus failed: ${(err as Error).message}`);
    }
  }

  /**
   * Credits a one-off referral bonus (new emission, not deducted from anyone).
   * Uses EconomyService.creditCoins so it never mints further passive (no
   * cascade), writing LedgerEntry(type='referral', refSource).
   */
  private async creditReferral(
    tx: PrismaTx,
    userId: string,
    amount: number,
    refSource: 'join' | 'premium',
    referralId: string,
  ): Promise<void> {
    if (amount <= 0) {
      return;
    }
    await this.economy.creditCoins(
      tx,
      userId,
      amount,
      'referral',
      referralId,
      refSource,
    );
  }

  // ── Anti-abuse gates ──────────────────────────────────────────────────────

  /**
   * Minimal-activity gate for the join bonus (anti-sybil): the referee must
   * have produced genuine server-authoritative income — i.e. at least one
   * coupon ledger entry. A finished coupon round counts as real play.
   */
  private async hasMinActivity(refereeId: string): Promise<boolean> {
    const earned = await this.prisma.ledgerEntry.count({
      where: { userId: refereeId, type: 'coupon' },
    });
    return earned > 0;
  }

  /** Enforces per-referrer daily and lifetime rewarded-referral caps. */
  private async withinReferralCaps(
    referrerId: string,
    cfg: GameConfig,
  ): Promise<boolean> {
    // Total rewarded referrals = referrals with any one-off bonus granted.
    const total = await this.prisma.referral.count({
      where: {
        referrerId,
        OR: [{ joinBonusGranted: true }, { premiumBonusGranted: true }],
      },
    });
    if (total >= cfg.referralTotalCap) {
      return false;
    }

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dailyRewarded = await this.prisma.ledgerEntry.count({
      where: {
        userId: referrerId,
        type: 'referral',
        refSource: { in: ['join', 'premium'] },
        createdAt: { gte: dayStart },
      },
    });
    return dailyRewarded < cfg.referralDailyCap;
  }

  // ── Profile + JWT ─────────────────────────────────────────────────────────

  /** Builds the public profile with lazily recomputed energy. */
  private async buildProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw AppError.unauthorized('User not found');
    }
    const stats = await this.economy.getEffectiveStats(userId);
    const snapshot = await this.economy.recomputeEnergy(user, Date.now(), {
      maxEnergy: stats.maxEnergy,
      energyRegen: stats.energyRegen,
    });

    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      isPremium: user.isPremium,
      coins: Number(user.coins),
      energy: snapshot.energy,
      maxEnergy: snapshot.maxEnergy,
      energyRegen: snapshot.energyRegen,
      energyUpdatedAt: snapshot.energyUpdatedAt,
      referralCode: user.referralCode,
      basketTier: user.basketTier,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Signs a short-lived session JWT carrying the userId. */
  private async signJwt(userId: string, cfg: GameConfig): Promise<string> {
    const payload: Pick<JwtPayload, 'sub' | 'userId'> = {
      sub: userId,
      userId,
    };
    return this.jwt.signAsync(payload, { expiresIn: cfg.jwtTtlSec });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_VIOLATION
    );
  }
}
