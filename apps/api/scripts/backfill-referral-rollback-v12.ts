/**
 * Backfill: roll back referral payouts to the GameConfig v12 values.
 *
 * v12 slashes referral bonuses and disables the passive stream:
 *   join     referrer 5000 -> 75 ,  referee 2000 -> 50
 *   premium  referrer 25000 -> 150, referee 2000 -> 150
 *   passive  referralPassiveRate 0.1 -> 0  (removed entirely)
 *
 * This script reconciles ALREADY-credited coins to those new numbers:
 *   - passive: clawed back in full (target 0).
 *   - join/premium: clawed back down to the new per-party value (per-entry
 *     delta = oldAmount - newTarget; only ever reduces, never tops up).
 *
 * Mechanics (decisions locked with the owner):
 *   - Method: COMPENSATING NEGATIVE ledger rows (the ledger stays immutable /
 *     append-only — we never edit or delete historical rows). Each reversal row
 *     carries the SAME refSource as its original, so ReferralService.aggregateEarnings
 *     nets out to the corrected total (passive -> 0, join -> 75, ...).
 *   - Balance: clamped at 0. We never push User.coins negative, so a user who
 *     already spent the bonus simply lands on 0. NOTE: for such clamped users
 *     User.coins will be GREATER than the sum of their ledger (the reversal row
 *     records the full intent; the balance floors). This divergence is accepted.
 *   - Idempotent: every reversal row is tagged refId = `rb-v12:<originalLedgerId>`.
 *     Re-running skips any original that already has its reversal row, so it is
 *     safe to run repeatedly and to resume after a partial failure.
 *
 * Also upserts the v12 GameConfig row (same effect as `pnpm prisma:seed`) so the
 * live API switches to the new numbers — without it the loader keeps serving the
 * highest existing version (v11 = old values).
 *
 * Usage:
 *   DRY_RUN=1 node --import tsx scripts/backfill-referral-rollback-v12.ts   # preview, no writes
 *   node --import tsx scripts/backfill-referral-rollback-v12.ts             # apply
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { DEFAULT_GAME_CONFIG } from '@lemur/shared';

const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SENTINEL = 'rb-v12:';

/** New per-party targets pulled straight from the v12 config (single source). */
const cfg = DEFAULT_GAME_CONFIG;
const TARGET = {
  join: { referrer: BigInt(cfg.referralJoinBonusReferrer), referee: BigInt(cfg.referralJoinBonusReferee) },
  premium: { referrer: BigInt(cfg.referralPremiumBonusReferrer), referee: BigInt(cfg.referralPremiumBonusReferee) },
  // passive is removed entirely -> target 0 regardless of party.
  passive: BigInt(0),
} as const;

type OriginalRow = {
  id: string;
  userId: string;
  amount: bigint;
  refSource: string | null;
  refId: string | null;
};

async function upsertConfigV12(): Promise<void> {
  if (DRY_RUN) {
    console.log(`[dry-run] would upsert GameConfig v${cfg.version}`);
    return;
  }
  await prisma.gameConfig.upsert({
    where: { version: cfg.version },
    create: { version: cfg.version, data: cfg as unknown as Prisma.InputJsonValue },
    update: { data: cfg as unknown as Prisma.InputJsonValue },
  });
  console.log(`Upserted GameConfig v${cfg.version} (live API will serve new referral numbers)`);
}

async function main(): Promise<void> {
  console.log(`=== Referral rollback backfill (v12) ${DRY_RUN ? '[DRY RUN]' : '[APPLY]'} ===`);
  await upsertConfigV12();

  // Already-written reversals -> the set of original ids to skip (idempotency).
  const existingReversals = await prisma.ledgerEntry.findMany({
    where: { type: 'referral', refId: { startsWith: SENTINEL } },
    select: { refId: true },
  });
  const alreadyReversed = new Set(
    existingReversals.map((r) => (r.refId ?? '').slice(SENTINEL.length)),
  );
  if (alreadyReversed.size) {
    console.log(`Found ${alreadyReversed.size} already-reversed originals; they will be skipped.`);
  }

  // All original referral credits (exclude our own reversal rows).
  const originals: OriginalRow[] = await prisma.ledgerEntry.findMany({
    where: {
      type: 'referral',
      refSource: { in: ['join', 'premium', 'passive'] },
      NOT: { refId: { startsWith: SENTINEL } },
    },
    select: { id: true, userId: true, amount: true, refSource: true, refId: true },
  });

  // For join/premium we must know which party (referrer vs referee) each credit
  // went to -> resolve via Referral.id (= refId for join/premium credits).
  const referralIds = Array.from(
    new Set(
      originals
        .filter((o) => o.refSource !== 'passive' && o.refId)
        .map((o) => o.refId as string),
    ),
  );
  const referrals = referralIds.length
    ? await prisma.referral.findMany({
        where: { id: { in: referralIds } },
        select: { id: true, referrerId: true, refereeId: true },
      })
    : [];
  const refById = new Map(referrals.map((r) => [r.id, r]));

  // Reversal plan, grouped by user.
  type Reversal = { originalId: string; amount: bigint; refSource: string };
  const perUser = new Map<string, Reversal[]>();
  const stats = {
    passive: { rows: 0, coins: 0n },
    join: { rows: 0, coins: 0n },
    premium: { rows: 0, coins: 0n },
    skippedAlready: 0,
    skippedNoOp: 0,
    skippedNoReferral: 0,
  };

  for (const o of originals) {
    if (alreadyReversed.has(o.id)) {
      stats.skippedAlready++;
      continue;
    }
    const source = o.refSource as 'join' | 'premium' | 'passive';
    let clawback: bigint;

    if (source === 'passive') {
      clawback = o.amount; // remove the whole passive credit
    } else {
      const ref = o.refId ? refById.get(o.refId) : undefined;
      if (!ref) {
        // Cannot determine the party (Referral gone) -> leave it untouched, flag it.
        stats.skippedNoReferral++;
        console.warn(`  ! ${source} ledger ${o.id}: referral ${o.refId} not found, skipped`);
        continue;
      }
      const party: 'referrer' | 'referee' =
        o.userId === ref.referrerId ? 'referrer' : 'referee';
      const target = TARGET[source][party];
      clawback = o.amount - target; // reduce down to the new value
    }

    if (clawback <= 0n) {
      // New value >= old credit (or zero credit) -> nothing to reverse.
      stats.skippedNoOp++;
      continue;
    }

    const list = perUser.get(o.userId) ?? [];
    list.push({ originalId: o.id, amount: clawback, refSource: source });
    perUser.set(o.userId, list);

    stats[source].rows++;
    stats[source].coins += clawback;
  }

  console.log(
    `Plan: ${perUser.size} users affected | ` +
      `passive ${stats.passive.rows} rows / ${stats.passive.coins} coins, ` +
      `join ${stats.join.rows} / ${stats.join.coins}, ` +
      `premium ${stats.premium.rows} / ${stats.premium.coins} | ` +
      `skipped: ${stats.skippedAlready} done, ${stats.skippedNoOp} no-op, ${stats.skippedNoReferral} no-referral`,
  );

  let clampedUsers = 0;
  let coinsActuallyRemoved = 0n;

  for (const [userId, reversals] of perUser) {
    const totalClawback = reversals.reduce((s, r) => s + r.amount, 0n);

    if (DRY_RUN) {
      coinsActuallyRemoved += totalClawback; // upper bound; real run clamps
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coins: true },
      });
      if (!user) {
        console.warn(`  ! user ${userId} not found, skipping ${reversals.length} reversals`);
        return;
      }

      // Append the compensating negative rows (full intent, always).
      await tx.ledgerEntry.createMany({
        data: reversals.map((r) => ({
          userId,
          amount: -r.amount,
          type: 'referral',
          refSource: r.refSource,
          refId: `${SENTINEL}${r.originalId}`,
        })),
      });

      // Decrement balance, clamped at 0 (never go negative).
      const decrement = totalClawback > user.coins ? user.coins : totalClawback;
      if (totalClawback > user.coins) {
        clampedUsers++;
      }
      coinsActuallyRemoved += decrement;

      await tx.user.update({
        where: { id: userId },
        data: { coins: { decrement }, version: { increment: 1 } },
      });
    });
  }

  console.log('=== Summary ===');
  console.log(`Users affected:        ${perUser.size}`);
  console.log(`Reversal rows written: ${stats.passive.rows + stats.join.rows + stats.premium.rows}`);
  console.log(`Coins clawed (ledger): ${stats.passive.coins + stats.join.coins + stats.premium.coins}`);
  console.log(`Coins removed (balance, clamped): ${coinsActuallyRemoved}`);
  console.log(`Users clamped at 0:    ${clampedUsers}`);
  if (DRY_RUN) {
    console.log('DRY RUN — no rows written. Re-run without DRY_RUN=1 to apply.');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
