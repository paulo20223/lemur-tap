/**
 * Upgrades screen — spec/app/04.
 *
 * Shows the upgrade branches (maxEnergy, energyRegen, couponMult, vault) with
 * current level, current/next effect, the next-level price (from
 * GET /upgrades), and a buy button (POST /upgrades/:type/buy) disabled when the
 * branch is maxed or the player cannot afford the next level.
 *
 * The server is authoritative: a successful buy returns the new level/price and
 * coin balance, which we merge into local state and into the shared store
 * (so the balance shown in other screens stays in sync).
 */
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  effectiveCouponMult,
  effectiveEnergyRegen,
  effectiveMaxEnergy,
  effectiveVaultCapacity,
  type GameConfig,
  type UpgradeStateDto,
  type UpgradeType,
} from '@lemur/shared';
import { apiClient, ApiClientError } from '../../api/client';
import { useGameStore } from '../../store';
import {
  BoltIcon,
  CoinIcon,
  EnergyIcon,
  FlameIcon,
  VaultIcon,
} from '../../components/icons';
import { useT } from '../../i18n';
import './Upgrades.css';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

interface BranchMeta {
  Icon: IconComponent;
  /**
   * Formatted effect value (no unit). Title/blurb and the unit suffix come from
   * the i18n dictionary (`upgrades.branches.<type>.{title,blurb,effect}`).
   */
  value: (level: number, cfg: GameConfig) => string;
}

const BRANCHES: Record<UpgradeType, BranchMeta> = {
  maxEnergy: {
    Icon: EnergyIcon,
    value: (level, cfg) => formatNum(effectiveMaxEnergy(level, cfg)),
  },
  energyRegen: {
    Icon: FlameIcon,
    value: (level, cfg) => formatRegen(effectiveEnergyRegen(level, cfg)),
  },
  couponMult: {
    Icon: CoinIcon,
    value: (level, cfg) => effectiveCouponMult(level, cfg).toFixed(1),
  },
  vault: {
    Icon: VaultIcon,
    value: (level, cfg) => formatNum(effectiveVaultCapacity(level, cfg)),
  },
};

/** Render order matches the spec table. */
const ORDER: UpgradeType[] = [
  'maxEnergy',
  'energyRegen',
  'couponMult',
  'vault',
];

function formatNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function formatRegen(n: number): string {
  // Regen can be fractional (0.5 per level); trim trailing zeros.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function Upgrades() {
  const t = useT();
  const config = useGameStore((s) => s.config);
  const profile = useGameStore((s) => s.profile);
  const applyProfile = useGameStore((s) => s.applyProfile);

  const coins = profile?.coins ?? 0;

  const [items, setItems] = useState<UpgradeStateDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Currently-buying branch (for per-card pending state), or null. */
  const [buying, setBuying] = useState<UpgradeType | null>(null);
  /** Coupon-boost purchase pending state. */
  const [boostBuying, setBoostBuying] = useState(false);

  // Buy the one-shot coupon boost: server refills energy for one attempt; the
  // authoritative coins/energy are merged back into the shared store.
  const buyBoost = useCallback(async () => {
    if (boostBuying) return;
    setBoostBuying(true);
    setError(null);
    try {
      const res = await apiClient.couponBoost();
      const p = useGameStore.getState().profile;
      if (p) {
        applyProfile({
          ...p,
          coins: res.coins,
          energy: res.energy,
          energyUpdatedAt: res.energyUpdatedAt,
        });
      }
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : t('upgrades.purchaseFailed'),
      );
    } finally {
      setBoostBuying(false);
    }
  }, [boostBuying, applyProfile, t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiClient.upgrades();
      setItems(list);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : t('upgrades.failedLoad'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = useCallback(
    async (type: UpgradeType) => {
      if (buying) return;
      setBuying(type);
      setError(null);
      try {
        const res = await apiClient.buyUpgrade(type);
        // Merge authoritative branch state into the local list.
        setItems((prev) =>
          (prev ?? []).map((it) =>
            it.type === res.type
              ? {
                  ...it,
                  level: res.level,
                  nextPrice: res.nextPrice,
                  maxed: res.nextPrice === null,
                }
              : it,
          ),
        );
        // Keep the shared coin balance in sync for other screens / nav.
        if (profile) {
          applyProfile({ ...profile, coins: res.coins });
        }
      } catch (e) {
        setError(
          e instanceof ApiClientError ? e.message : t('upgrades.purchaseFailed'),
        );
        // Re-sync from the server in case state drifted (e.g. stale balance).
        void load();
      } finally {
        setBuying(null);
      }
    },
    [buying, profile, applyProfile, load, t],
  );

  // Index branch states by type for stable, spec-ordered rendering.
  const byType = useMemo(() => {
    const map = new Map<UpgradeType, UpgradeStateDto>();
    for (const it of items ?? []) map.set(it.type, it);
    return map;
  }, [items]);

  return (
    <div className="upgrades">
      {error && (
        <div className="upgrades__error" role="alert">
          <span>{error}</span>
          <button className="upgrades__retry" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {config && (
        <div className="card upg upg--boost">
          <div className="upg__top">
            <span className="upg__icon upg__icon--boost" aria-hidden>
              <BoltIcon size={26} />
            </span>
            <div className="upg__head">
              <div className="upg__title">{t('upgrades.boost.title')}</div>
              <div className="upg__blurb">{t('upgrades.boost.blurb')}</div>
            </div>
          </div>

          <div className="upg__effect">
            <span className="upg__effect-now">
              {t('upgrades.boost.effect', {
                energy: formatNum(config.couponBoostEnergyGrant),
              })}
            </span>
          </div>

          <button
            className="btn upg__buy"
            disabled={boostBuying || coins < config.couponBoostPrice}
            onClick={() => void buyBoost()}
          >
            {boostBuying ? (
              t('upgrades.boost.buying')
            ) : (
              <span className="upg__price num">
                <CoinIcon size={20} className="upg__coin" />
                {formatNum(config.couponBoostPrice)}
              </span>
            )}
          </button>

          {coins < config.couponBoostPrice && !boostBuying && (
            <div className="upg__hint">{t('upgrades.notEnoughCoins')}</div>
          )}
        </div>
      )}

      {loading && !items && (
        <div className="upgrades__center">
          <div className="spinner" />
        </div>
      )}

      {!loading && items && items.length === 0 && (
        <div className="upgrades__center upgrades__empty">
          {t('upgrades.empty')}
        </div>
      )}

      {items && items.length > 0 && config && (
        <div className="upgrades__list">
          {ORDER.filter((t) => byType.has(t)).map((type) => {
            const state = byType.get(type)!;
            const meta = BRANCHES[type];
            const Icon = meta.Icon;
            const price = state.nextPrice;
            const affordable = price !== null && coins >= price;
            const isBuying = buying === type;
            const disabled = state.maxed || !affordable || isBuying || !!buying;

            const effectKey =
              `upgrades.branches.${type}.effect` as const;
            const currentEffect = t(effectKey, {
              value: meta.value(state.level, config),
            });
            const nextEffect = state.maxed
              ? null
              : t(effectKey, { value: meta.value(state.level + 1, config) });

            return (
              <div className="card upg" key={type}>
                <div className="upg__top">
                  <span className="upg__icon" aria-hidden>
                    <Icon size={26} />
                  </span>
                  <div className="upg__head">
                    <div className="upg__title">
                      {t(`upgrades.branches.${type}.title`)}
                    </div>
                    <div className="upg__blurb">
                      {t(`upgrades.branches.${type}.blurb`)}
                    </div>
                  </div>
                  <div className="upg__level num">
                    {state.maxed ? (
                      <span className="upg__max">{t('upgrades.max')}</span>
                    ) : (
                      <span className="upg__lvl">
                        {t('upgrades.level', { level: state.level })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="upg__effect">
                  <span className="upg__effect-now num">{currentEffect}</span>
                  {nextEffect && (
                    <>
                      <span className="upg__arrow" aria-hidden>
                        →
                      </span>
                      <span className="upg__effect-next num">{nextEffect}</span>
                    </>
                  )}
                </div>

                <button
                  className="btn upg__buy"
                  disabled={disabled}
                  onClick={() => void buy(type)}
                >
                  {state.maxed ? (
                    t('upgrades.maxed')
                  ) : isBuying ? (
                    t('upgrades.buying')
                  ) : (
                    <span className="upg__price num">
                      <CoinIcon size={20} className="upg__coin" />
                      {formatNum(price ?? 0)}
                    </span>
                  )}
                </button>

                {!state.maxed && !affordable && !isBuying && (
                  <div className="upg__hint">{t('upgrades.notEnoughCoins')}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
