/**
 * Leaderboard screen — global ranking by current coin balance, as a table.
 *
 * A dense, scannable table in the app's warm clay language: a sticky header,
 * hairline-divided rows, medal badges on the top three ranks, and the viewer's
 * own row tinted inline. When the viewer sits outside the visible page, their
 * row is pinned to a sticky "your position" bar so it's always in reach.
 *
 * Data source: leaderboard.top via the typed oRPC client. The server is the sole
 * source of rank; `me` is the viewer's authoritative row even when off-list.
 */
import { useCallback, useEffect, useState } from 'react';
import type { LeaderboardEntryDto, LeaderboardResponse } from '@lemur/shared';
import { apiClient } from '../../api/client';
import { useGameStore } from '../../store';
import { TrophyIcon } from '../../components/icons';
import { useT } from '../../i18n';
import './leaderboard.css';

/** Compact whole-coin formatter (1 234 567). */
function formatCoins(n: number): string {
  return Math.trunc(n).toLocaleString('en-US').replace(/,/g, ' ');
}

/** Short, stable player handle — `#` + the last 6 of the user id. */
function idOf(e: LeaderboardEntryDto): string {
  return `#${e.userId.slice(-6)}`;
}

/** Medal tier (gold/silver/bronze) for the first three ranks, else null. */
function tierOf(rank: number): 'gold' | 'silver' | 'bronze' | null {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : null;
}

export default function Leaderboard() {
  const t = useT();
  const meId = useGameStore((s) => s.profile?.id);

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.leaderboard({ limit: 50 });
      setData(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('leaderboard.failedLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="screen lb">
        <Header />
        <div className="lb-skeleton lb-skeleton--table" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="screen lb">
        <Header />
        <div className="card lb-error">
          <p>{error}</p>
          <button className="btn" onClick={() => void load()}>
            {t('common.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { top, me, total } = data;

  if (top.length === 0) {
    return (
      <div className="screen lb">
        <Header />
        <div className="card lb-empty">
          <div className="lb-empty__icon" aria-hidden="true">
            <TrophyIcon size={30} />
          </div>
          <p className="lb-empty__title text-balance">
            {t('leaderboard.noRanks')}
          </p>
          <p className="lb-empty__hint text-pretty">
            {t('leaderboard.noRanksHint')}
          </p>
        </div>
      </div>
    );
  }

  const meInTop = me ? top.some((e) => e.userId === me.userId) : false;

  return (
    <div className="screen lb">
      <Header total={total} />

      <div className="card lb-tablecard">
        <table className="lb-table">
          <thead>
            <tr>
              <th scope="col" className="lb-th lb-th--rank">
                #
              </th>
              <th scope="col" className="lb-th lb-th--player">
                {t('leaderboard.player')}
              </th>
              <th scope="col" className="lb-th lb-th--coins">
                {t('leaderboard.coins')}
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((e) => (
              <DataRow key={e.userId} entry={e} isMe={e.userId === meId} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pin the viewer's row only when it isn't already visible above. */}
      {me && !meInTop && (
        <div
          className="lb-you"
          role="status"
          aria-label={t('leaderboard.yourPosition')}
        >
          <table className="lb-table lb-table--pinned">
            <tbody>
              <DataRow entry={me} isMe pinned />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Header({ total }: { total?: number }) {
  const t = useT();
  return (
    <header className="lb-head">
      <h1 className="screen__title">{t('leaderboard.title')}</h1>
      <p className="lb-head__sub">
        {t('leaderboard.rankedByCoins')}
        {total !== undefined && total > 0 && (
          <>
            {' · '}
            <span className="num">{formatCoins(total)}</span>{' '}
            {t('leaderboard.players', { count: total })}
          </>
        )}
      </p>
    </header>
  );
}

function DataRow({
  entry,
  isMe,
  pinned,
}: {
  entry: LeaderboardEntryDto;
  isMe?: boolean;
  pinned?: boolean;
}) {
  const t = useT();
  const tier = tierOf(entry.rank);
  return (
    <tr
      className={`lb-tr${isMe ? ' lb-tr--me' : ''}${pinned ? ' lb-tr--pinned' : ''}`}
    >
      <td className="lb-td lb-td--rank">
        <span className="lb-rank" data-tier={tier ?? undefined}>
          {entry.rank}
        </span>
      </td>
      <td className="lb-td lb-td--player">
        <span className="lb-name num">
          {pinned ? t('leaderboard.you') : idOf(entry)}
          {isMe && !pinned && (
            <span className="lb-you-chip">{t('leaderboard.you')}</span>
          )}
        </span>
      </td>
      <td className="lb-td lb-td--coins">
        <span className="lb-coins num">{formatCoins(entry.coins)}</span>
      </td>
    </tr>
  );
}
