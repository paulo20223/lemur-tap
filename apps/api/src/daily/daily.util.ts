/**
 * UTC date helpers for the daily-bonus streak logic (spec/app/07).
 * The "claim day" is the calendar day in UTC; streak diffs are whole-day deltas.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (00:00:00.000) UTC of the day containing `at`. */
export function utcDateOnly(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

/** Next UTC midnight strictly after `at` (start of tomorrow, UTC). */
export function nextUtcMidnight(at: Date): Date {
  return new Date(utcDateOnly(at).getTime() + DAY_MS);
}

/** Whole-day difference (a − b) between two UTC date-only values. */
export function utcDayDiff(a: Date, b: Date): number {
  return Math.round((utcDateOnly(a).getTime() - utcDateOnly(b).getTime()) / DAY_MS);
}

/** Milliseconds from `at` until the next UTC midnight (>0). */
export function msUntilNextUtcMidnight(at: Date): number {
  return nextUtcMidnight(at).getTime() - at.getTime();
}

/**
 * Reward for a streak from the config table. day = min(streak, 7), 1-based,
 * mapped onto dailyRewards[day-1] (dailyRewards[6] = day 7+).
 */
export function rewardForStreak(streak: number, dailyRewards: number[]): number {
  const day = Math.min(Math.max(streak, 1), dailyRewards.length);
  return dailyRewards[day - 1] ?? 0;
}
