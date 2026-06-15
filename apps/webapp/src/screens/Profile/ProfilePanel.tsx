/**
 * Profile panel — identity + live balances, one tab of the Profile page.
 *
 * Pure presentation over already-bootstrapped client state: the profile and the
 * live (client-side regenerated) energy come from the global store, the display
 * name/avatar from the Telegram launch context. No own fetch, so no loading or
 * error state of its own — the app shell guarantees a ready profile before this
 * page renders.
 *
 * Same "quiet luxury" surface language as the Friends tab (shared --ref-* tokens
 * and the .ref-sheet primitive): a centred identity credential, then a single
 * balance statement (coins lead total + a hairline-divided energy meter).
 */
import { useEffect, useState } from 'react';
import { useGameStore } from '../../store';
import { getTelegramContext } from '../../telegram';
import { CoinIcon, EnergyIcon, TrophyIcon } from '../../components/icons';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { useI18n } from '../../i18n';
import { skinVariant, resolveSkinId, DEFAULT_SKIN_ID } from '../Shop/skins';

/** Compact whole-coin formatter (1 234 567). */
function formatCoins(n: number): string {
  return Math.trunc(n).toLocaleString('en-US').replace(/,/g, ' ');
}

/** Energy/sec with one decimal only when it carries information. */
function formatRegen(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "Jun 2026" from an ISO timestamp; empty on a bad date. */
function formatJoined(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}

export default function ProfilePanel() {
  const { t, locale } = useI18n();
  const profile = useGameStore((s) => s.profile);
  const energy = useGameStore((s) => s.energy);
  const equippedSkinId = useGameStore((s) => s.shopCatalog?.equippedSkinId ?? null);
  const loadShopCatalog = useGameStore((s) => s.loadShopCatalog);
  // Fall back to the monogram if the Telegram photo URL is absent or fails.
  const [photoFailed, setPhotoFailed] = useState(false);

  // Load the catalog (which carries equippedSkinId) so the avatar can show the
  // equipped skin. Best-effort, runs once if not already loaded.
  useEffect(() => {
    if (equippedSkinId === null) void loadShopCatalog().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!profile) return null;

  const tg = getTelegramContext().user;

  // Display name: real Telegram name → @handle → anonymous Lemur id.
  const fullName = [tg?.firstName, tg?.lastName].filter(Boolean).join(' ').trim();
  const handle = profile.username ?? tg?.username ?? null;
  const lemurId = `#${profile.id.slice(-6).toUpperCase()}`;
  const name =
    fullName || (handle ? `@${handle}` : t('profile.anonName', { id: lemurId }));
  // Show the handle line only when it adds something the name line doesn't.
  const showHandle = Boolean(handle) && name !== `@${handle}`;

  const isPremium = profile.isPremium || Boolean(tg?.isPremium);
  const monogram = (
    tg?.firstName?.[0] ??
    profile.username?.[0] ??
    'L'
  ).toUpperCase();
  const photoUrl = !photoFailed ? tg?.photoUrl : undefined;

  // Equipped cosmetic skin — shown as a small glyph badge on the avatar (the
  // default 'classic' skin adds nothing). Graceful fallback for unknown ids.
  const skinId = resolveSkinId(equippedSkinId);
  const showSkin = skinId !== DEFAULT_SKIN_ID;
  const skin = skinVariant(skinId);

  const maxEnergy = profile.maxEnergy;
  const shown = Math.floor(energy);
  const pct = maxEnergy > 0 ? Math.min(100, (energy / maxEnergy) * 100) : 0;
  const joined = formatJoined(profile.createdAt, locale);

  return (
    <div className="panel">
      {/* Identity credential */}
      <section className="ref-sheet prof-id">
        <div
          className="prof-avatar"
          data-premium={isPremium || undefined}
          aria-hidden="true"
        >
          {photoUrl ? (
            <img
              className="prof-avatar__img"
              src={photoUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            monogram
          )}
          {showSkin && (
            <span
              className="prof-avatar__skin"
              style={{ '--skin-accent': skin.accent } as React.CSSProperties}
            >
              {skin.glyph}
            </span>
          )}
        </div>

        <h2 className="prof-name">{name}</h2>
        {showHandle && <p className="prof-handle">@{handle}</p>}

        {isPremium && (
          <span className="prof-premium">
            <TrophyIcon size={12} />
            {t('profile.telegramPremium')}
          </span>
        )}

        <div className="prof-meta">
          <div className="prof-meta__item">
            <span className="prof-meta__label">{t('profile.memberSince')}</span>
            <span className="prof-meta__value">{joined || '—'}</span>
          </div>
          <div className="prof-meta__item">
            <span className="prof-meta__label">{t('profile.lemurId')}</span>
            <span className="prof-meta__value prof-meta__value--mono">
              {lemurId}
            </span>
          </div>
        </div>
      </section>

      {/* Balance statement: coins lead total + hairline energy meter */}
      <section className="ref-sheet prof-balance">
        <p className="ref-eyebrow">{t('profile.coinBalance')}</p>
        <div className="prof-coins num">
          <CoinIcon size={28} />
          <span>{formatCoins(profile.coins)}</span>
        </div>

        <div className="prof-energy">
          <div className="prof-energy__head">
            <EnergyIcon size={18} />
            <span className="prof-energy__label">{t('profile.energy')}</span>
            <span className="prof-energy__count num">
              <b>{shown}</b> / {maxEnergy}
            </span>
          </div>
          <div
            className="prof-energy__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={maxEnergy}
            aria-valuenow={shown}
            aria-label={t('profile.energy')}
          >
            <div className="prof-energy__fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="prof-energy__regen">
            {t('profile.regenerates', {
              rate: formatRegen(profile.energyRegen),
            })}
          </p>
        </div>
      </section>

      <LanguageSwitcher />
    </div>
  );
}
