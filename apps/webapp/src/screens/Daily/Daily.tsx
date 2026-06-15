/**
 * Daily bonus screen (spec/app/07).
 *
 * Shows the streak reward track (day 1..7+), highlights today's claimable day,
 * lets the user claim via POST /daily/claim, and counts down to the next
 * UTC-midnight claim window. The /me coin balance is reconciled through the
 * shared store after a successful claim.
 *
 * Layout: a fixed full-height flex column that fits above the floating nav
 * without scrolling. The hero grows to center itself; the 7-day rail pins to
 * the bottom of the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyStatusResponse } from '@lemur/shared';
import { apiClient, ApiClientError } from '../../api/client';
import { useGameStore } from '../../store';
import {
  CoinIcon,
  FlameIcon,
  TrophyIcon,
  CheckIcon,
  LockIcon,
  ClockIcon,
} from '../../components/icons';
import { useT } from '../../i18n';
import './daily.css';

/** Day labels for the 7-node rail; index 6 is "7+" (capped). */
const DAY_LABELS = ['1', '2', '3', '4', '5', '6', '7+'];

type LoadState = 'loading' | 'ready' | 'error';

function formatCoins(n: number): string {
  return n.toLocaleString('en-US');
}

/** Compact reward label for the rail nodes (e.g. 5000 -> "5k", 1500 -> "1.5k"). */
function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

/** Format a positive ms duration as HH:MM:SS. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function Daily() {
  const t = useT();
  const config = useGameStore((s) => s.config);
  const profile = useGameStore((s) => s.profile);
  const applyProfile = useGameStore((s) => s.applyProfile);

  const [state, setState] = useState<LoadState>('loading');
  const [status, setStatus] = useState<DailyStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Reward table from live config (day 1..7+); empty until config loads.
  const rewards = config?.dailyRewards ?? [];

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const resp = await apiClient.daily();
      setStatus(resp);
      setState('ready');
    } catch (e) {
      const msg =
        e instanceof ApiClientError ? e.message : t('daily.failedLoad');
      setError(msg);
      setState('error');
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tick the countdown once per second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // When the countdown elapses, the claim window has opened — refetch status.
  const reloadedAtRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const nextMs = Date.parse(status.nextClaimAtUtc);
    if (Number.isNaN(nextMs)) return;
    if (now >= nextMs && reloadedAtRef.current !== status.nextClaimAtUtc) {
      reloadedAtRef.current = status.nextClaimAtUtc;
      void load();
    }
  }, [now, status, load]);

  const handleClaim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    setError(null);
    try {
      const resp = await apiClient.dailyClaim();
      // Reconcile coin balance into the shared store.
      if (profile) {
        applyProfile({ ...profile, coins: resp.coins });
      }
      // Refresh full status (alreadyClaimedToday, nextReward, countdown).
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'daily_already_claimed') {
        // Lost a race / stale state — just resync.
        await load();
      } else {
        setError(
          e instanceof ApiClientError ? e.message : t('daily.claimFailed'),
        );
      }
    } finally {
      setClaiming(false);
    }
  }, [claiming, profile, applyProfile, load, t]);

  if (state === 'loading') {
    return (
      <div className="daily">
        <div className="card daily__center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (state === 'error' || !status) {
    return (
      <div className="daily">
        <div className="card daily__center">
          <p className="daily__error">{error ?? t('common.somethingWrong')}</p>
          <button className="btn btn--block" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  const claimable = !status.alreadyClaimedToday;
  const nextMs = Date.parse(status.nextClaimAtUtc);
  const remaining = Number.isNaN(nextMs) ? 0 : nextMs - now;

  // The day the user is on right now (1-based, capped at 7).
  const activeDay = status.currentDay;
  const activeIndex = Math.min(Math.max(activeDay - 1, 0), 6);
  // Fraction of the rail (0..1) the gold "progress" line should fill, measured
  // node-center to node-center across the 7 evenly-spaced nodes.
  const trackProgress = activeIndex / (DAY_LABELS.length - 1);

  return (
    <div className="daily">
      <div className="daily__streak num" title={t('daily.currentStreak')}>
        <FlameIcon size={15} className="daily__streak-flame" />
        <span className="daily__streak-count">{status.streak}</span>
        <span className="daily__streak-label">
          {t('daily.streakLabel', { count: status.streak })}
        </span>
      </div>

      {/* Today's reward / claim hero — centered in the free space between the
          streak chip and the rail. */}
      <section className="card daily__hero">
        <div className="daily__medallion" aria-hidden="true">
          <TrophyIcon size={38} />
        </div>

        <div className="daily__hero-label">
          {claimable ? t('daily.todayReward') : t('daily.nextReward')}
        </div>
        <div className="daily__hero-amount num">
          <CoinIcon size={30} className="daily__coin" />
          {formatCoins(claimable ? status.todayReward : status.nextReward)}
        </div>

        <button
          className="btn btn--block daily__claim"
          disabled={!claimable || claiming}
          onClick={() => void handleClaim()}
        >
          {claiming
            ? t('daily.claiming')
            : claimable
              ? t('daily.claim', { amount: formatCoins(status.todayReward) })
              : t('daily.claimedToday')}
        </button>

        {!claimable && (
          <div className="daily__countdown num">
            <ClockIcon size={14} />
            <span>
              {t('daily.nextClaimIn', { time: formatCountdown(remaining) })}
            </span>
          </div>
        )}
        {error && (
          <div className="daily__error daily__error--inline">{error}</div>
        )}

        <p className="daily__note">{t('daily.note')}</p>
      </section>

      {/* 7-day streak rail: nodes on a gold progress line. */}
      <div
        className="daily__rail"
        style={{ '--progress': trackProgress } as React.CSSProperties}
      >
        <div className="daily__line" aria-hidden="true">
          <div className="daily__line-fill" />
        </div>
        {DAY_LABELS.map((label, i) => {
          const reward = rewards[i];
          const dayNum = i + 1; // 1..7
          const isActive = dayNum === activeDay;
          const isPast = dayNum < activeDay;
          // Collected: today already done, or a past day in the current streak.
          const isDone = isPast || (isActive && !claimable);
          // Locked: a future day not yet reached.
          const isLocked = dayNum > activeDay;
          const cls = [
            'daily__node',
            isActive && claimable && 'daily__node--today',
            isDone && 'daily__node--done',
            isLocked && 'daily__node--locked',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={label} className={cls}>
              <div className="daily__dot" aria-hidden="true">
                {isDone ? (
                  <CheckIcon size={16} />
                ) : isLocked ? (
                  <LockIcon size={14} />
                ) : (
                  <CoinIcon size={17} />
                )}
              </div>
              <div className="daily__node-reward num">
                {reward !== undefined ? formatCompact(reward) : '—'}
              </div>
              <div className="daily__node-day">
                {t('daily.day', { label })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
