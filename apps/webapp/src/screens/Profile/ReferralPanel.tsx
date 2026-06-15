/**
 * Friends panel (spec/app/09) — the referral program as one tab of the Profile
 * page. "Quiet luxury" presentation: the program is framed as a royalty (you
 * keep 10% of every friend's earnings, forever). Layout leads with that value
 * prop, presents the invite code as a membership credential, the earnings as a
 * single statement (total + a hairline-divided ledger), and the referrals as a
 * refined roster.
 *
 * This is the former Referral screen with its outer `.screen` wrapper and page
 * title removed — the Profile page now owns the heading and the segmented
 * control. Data flow, pagination, clipboard and share behaviour are untouched:
 * data still comes from `referral.list` via the typed oRPC client.
 */
import { useCallback, useEffect, useState } from 'react';
import { shareURL, openTelegramLink } from '@telegram-apps/sdk-react';
import type { ReferralResponse, ReferralItemDto } from '@lemur/shared';
import { apiClient } from '../../api/client';
import LemurMascot from '../../components/LemurMascot';
import {
  CoinIcon,
  UsersIcon,
  CheckIcon,
  TrophyIcon,
  CopyIcon,
  SendIcon,
} from '../../components/icons';
import { useI18n, type MessageKey } from '../../i18n';

const PAGE_SIZE = 20;

/** Compact whole-coin formatter (1 234 567). */
function formatCoins(n: number): string {
  return Math.trunc(n).toLocaleString('en-US').replace(/,/g, ' ');
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function refereeLabel(
  r: ReferralItemDto,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (r.username) return `@${r.username}`;
  return t('referral.lemurName', { id: r.userId.slice(-6) });
}

/** Single uppercase glyph for the roster monogram. */
function monogram(r: ReferralItemDto): string {
  const ch = (r.username?.[0] ?? 'L').toUpperCase();
  return ch;
}

export default function ReferralPanel() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<ReferralResponse | null>(null);
  const [items, setItems] = useState<ReferralItemDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.referral({ limit: PAGE_SIZE });
      setData(resp);
      setItems(resp.referrals);
      setCursor(resp.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('referral.failedLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — share remains the primary action */
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const resp = await apiClient.referral({ limit: PAGE_SIZE, cursor });
      setItems((prev) => [...prev, ...resp.referrals]);
      setCursor(resp.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('referral.failedLoadMore'));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, t]);

  const onShare = useCallback(() => {
    if (!data) return;
    // Prefer the native Telegram share sheet; fall back to opening the link,
    // then to a clipboard copy outside Telegram.
    if (shareURL.isAvailable()) {
      shareURL(data.link, t('referral.shareText'));
    } else if (openTelegramLink.isAvailable()) {
      openTelegramLink(data.link);
    } else {
      void copyToClipboard(data.link);
    }
  }, [data, copyToClipboard, t]);

  if (loading) {
    return (
      <div className="panel">
        <div className="ref-skeleton ref-skeleton--tall" />
        <div className="ref-skeleton" />
        <div className="ref-skeleton ref-skeleton--list" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="panel">
        <div className="ref-sheet ref-error">
          <p>{error}</p>
          <button className="btn" onClick={() => void loadFirstPage()}>
            {t('common.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { code, earnings } = data;

  return (
    <div className="panel">
      {/* Invite: value prop, credential, link, share */}
      <section className="ref-sheet ref-invite">
        <div className="ref-invite__emblem" aria-hidden="true">
          <LemurMascot size={64} />
        </div>

        <p className="ref-eyebrow">{t('referral.program')}</p>
        <h2 className="ref-lead">
          {t('referral.leadPrefix')}{' '}
          <span className="ref-lead__accent">{t('referral.leadAccent')}</span>{' '}
          {t('referral.leadSuffix')}
        </h2>
        <p className="ref-sub">{t('referral.sub')}</p>

        <div className="ref-cred">
          <span className="ref-cred__label">{t('referral.yourCode')}</span>
          <span className="ref-cred__value num">{code}</span>
        </div>

        <label className="ref-link" htmlFor="ref-link-input">
          <span className="ref-link__label">{t('referral.inviteLink')}</span>
          <div className="ref-link__field">
            <input
              id="ref-link-input"
              className="ref-link__input num"
              type="text"
              value={data.link}
              readOnly
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="ref-copy"
              type="button"
              data-copied={copied || undefined}
              aria-label={copied ? t('referral.copiedAria') : t('referral.copyAria')}
              onClick={() => void copyToClipboard(data.link)}
            >
              {copied ? <CheckIcon size={17} /> : <CopyIcon size={17} />}
              <span>{copied ? t('referral.copied') : t('referral.copy')}</span>
            </button>
          </div>
        </label>

        <button className="btn btn--block ref-share" onClick={onShare}>
          <SendIcon size={19} />
          <span>{t('referral.shareInvite')}</span>
        </button>
      </section>

      {/* Earnings: one statement — lead total + hairline ledger */}
      <section className="ref-sheet ref-earn">
        <p className="ref-eyebrow">{t('referral.totalEarned')}</p>
        <div className="ref-earn__total num">
          <CoinIcon size={28} />
          <span>{formatCoins(earnings.total)}</span>
        </div>
        <div className="ref-earn__ledger">
          <LedgerItem label={t('referral.ledgerJoin')} value={earnings.join} />
          <LedgerItem label={t('referral.ledgerPremium')} value={earnings.premium} />
          <LedgerItem label={t('referral.ledgerPassive')} value={earnings.passive} />
        </div>
      </section>

      {/* Roster */}
      <section className="ref-sheet ref-list">
        <header className="ref-list__head">
          <h3 className="ref-list__title">{t('referral.yourReferrals')}</h3>
          <span className="ref-list__count num">{items.length}</span>
        </header>

        {items.length === 0 ? (
          <div className="ref-empty">
            <div className="ref-empty__icon" aria-hidden="true">
              <UsersIcon size={30} />
            </div>
            <p className="ref-empty__title">{t('referral.noReferrals')}</p>
            <p className="ref-empty__hint">{t('referral.noReferralsHint')}</p>
            <button
              className="btn ref-empty__cta"
              type="button"
              onClick={onShare}
            >
              <SendIcon size={19} />
              <span>{t('referral.inviteFriend')}</span>
            </button>
          </div>
        ) : (
          <ul className="ref-rows">
            {items.map((r) => (
              <li className="ref-row" key={r.userId}>
                <span
                  className="ref-row__avatar"
                  data-premium={r.isPremium || undefined}
                  aria-hidden="true"
                >
                  {monogram(r)}
                </span>
                <span className="ref-row__main">
                  <span className="ref-row__name">{refereeLabel(r, t)}</span>
                  <span className="ref-row__date">
                    {formatDate(r.joinedAt, locale)}
                  </span>
                </span>
                {r.isPremium && (
                  <span className="ref-row__premium">
                    <TrophyIcon size={12} />
                    {t('referral.premium')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && items.length > 0 && (
          <p className="ref-list__error">{error}</p>
        )}

        {cursor && (
          <button
            className="btn btn--ghost btn--block ref-list__more"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? t('common.loadingMore') : t('referral.loadMore')}
          </button>
        )}
      </section>
    </div>
  );
}

function LedgerItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="ref-ledger__item">
      <span className="ref-ledger__value num">{formatCoins(value)}</span>
      <span className="ref-ledger__label">{label}</span>
    </div>
  );
}
