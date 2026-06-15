/**
 * Staking screen (route /staking) — the offline yield engine (spec/app/08).
 *
 * - Tier cards (flex/lock) showing daily rate, lock term and minimum.
 * - Stake form: amount input + tier selection, client-side validation mirroring
 *   the server rules (spec/app/08): integer > 0, >= tier minimum, <= balance.
 *   One position per tier; staking an existing tier tops it up.
 * - Active positions: a storage bar (accrued/capacity) that ticks optimistically
 *   via the shared `stakeAccrual`, a Claim button (banks storage into the wallet),
 *   a "full" cue, and Unstake — with an explicit confirm + penalty for a
 *   still-locked position.
 *
 * Uses the shared API client + the global game store (profile/config). Balance
 * is re-synced from /me after every mutation so the rest of the app stays
 * consistent.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import {
  STAKING_BOOSTS,
  STAKING_TIERS,
  stakeAccrual,
  stakeBoostPrice,
  type StakePositionDto,
  type StakingBoost,
  type StakingTier,
} from '@lemur/shared';
import { apiClient, ApiClientError } from '../../api/client';
import { useGameStore } from '../../store';
import {
  VaultIcon,
  CoinIcon,
  LockIcon,
  FlameIcon,
  ClockIcon,
  CheckIcon,
  EnergyIcon,
  BoostsIcon,
} from '../../components/icons';
import { useI18n, type MessageKey } from '../../i18n';
import styles from './Staking.module.css';

type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Icon for each per-position boost (labels/nouns come from i18n, spec/app/08 §5). */
const BOOST_ICONS: Record<StakingBoost, ComponentType<{ size?: number }>> = {
  rate: EnergyIcon,
  capacity: VaultIcon,
  unfreeze: LockIcon,
};

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Daily rate fraction -> percent string, e.g. 0.06 -> "6%". */
function ratePct(rate: number): string {
  return `${+(rate * 100).toFixed(3)}%`;
}

function termLabel(termDays: number, t: TFn): string {
  if (termDays <= 0) return t('staking.noLock');
  return t('staking.lockTerm', { days: termDays });
}

/** Current cumulative effect of a boost at `level`, e.g. "+40% доходность". */
function boostEffectLabel(
  boost: StakingBoost,
  level: number,
  perLevel: number,
  t: TFn,
): string {
  if (level <= 0) return t('staking.noBonus');
  const pct = Math.round(perLevel * level * 100);
  const sign = boost === 'unfreeze' ? '−' : '+';
  return t('staking.boostEffect', {
    sign,
    pct,
    noun: t(`staking.boostMeta.${boost}.noun`),
  });
}

/** Human countdown until an ISO unlock time, e.g. "6d 3h". */
function untilLabel(unlockAt: string, now: number, t: TFn): string {
  const ms = new Date(unlockAt).getTime() - now;
  if (ms <= 0) return t('staking.unlocked');
  const totalMin = Math.ceil(ms / 60_000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function errMessage(e: unknown, t: TFn): string {
  if (e instanceof ApiClientError) {
    switch (e.code) {
      case 'stake_locked':
        return t('staking.errors.stakeLocked');
      case 'stake_not_found':
        return t('staking.errors.stakeNotFound');
      case 'insufficient_coins':
        return t('staking.errors.insufficientCoins');
      case 'amount_below_min':
        return t('staking.errors.amountBelowMin');
      case 'unknown_tier':
        return t('staking.errors.unknownTier');
      case 'unknown_boost':
        return t('staking.errors.unknownBoost');
      case 'max_level':
        return t('staking.errors.maxLevel');
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : t('common.somethingWrong');
}

export default function Staking() {
  const { t } = useI18n();
  const profile = useGameStore((s) => s.profile);
  const config = useGameStore((s) => s.config);
  const applyProfile = useGameStore((s) => s.applyProfile);

  const coins = profile?.coins ?? 0;
  const tierLabel = useCallback(
    (tier: StakingTier) => t(`staking.tiers.${tier}`),
    [t],
  );

  const [positions, setPositions] = useState<StakePositionDto[] | null>(null);
  // Epoch-ms anchor at which the positions' storageAccrued was measured
  // server-side; the bar extrapolates from here via the shared accrual function.
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTier, setSelectedTier] = useState<StakingTier>('flex');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Tick for live unlock countdowns + optimistic storage bar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await apiClient.staking();
      setPositions(list);
      setFetchedAt(Date.now());
    } catch (e) {
      setLoadError(errMessage(e, t));
      setPositions((prev) => prev ?? []);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const syncProfile = useCallback(async () => {
    try {
      const me = await apiClient.me();
      applyProfile(me);
    } catch {
      /* non-fatal: balance will re-sync on next bootstrap/refresh */
    }
  }, [applyProfile]);

  const tierCfg = config?.staking[selectedTier];
  const minStake = tierCfg?.minStake ?? 0;
  const activeCount = positions?.length ?? 0;
  const existingForTier = positions?.find((p) => p.tier === selectedTier);
  const hasPositions = activeCount > 0;

  // Hero secondary metrics: total principal at work + its projected daily yield.
  const totalStaked = useMemo(
    () => (positions ?? []).reduce((sum, p) => sum + p.amount, 0),
    [positions],
  );
  const totalDaily = useMemo(
    () =>
      Math.floor(
        (positions ?? []).reduce((sum, p) => sum + p.amount * Number(p.rateDaily), 0),
      ),
    [positions],
  );

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? Math.floor(n) : NaN;
  }, [amount]);

  const validate = useCallback((): string | null => {
    if (!config) return t('staking.errors.loadingConfig');
    if (!amount.trim() || Number.isNaN(parsedAmount))
      return t('staking.errors.enterAmount');
    if (parsedAmount <= 0) return t('staking.errors.amountPositive');
    if (parsedAmount < minStake)
      return t('staking.errors.minimumFor', {
        tier: tierLabel(selectedTier),
        amount: fmt(minStake),
      });
    if (parsedAmount > coins) return t('staking.errors.notEnoughCoins');
    return null;
  }, [config, amount, parsedAmount, minStake, selectedTier, coins, t, tierLabel]);

  const onStake = useCallback(async () => {
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await apiClient.stake(parsedAmount, selectedTier);
      setAmount('');
      setToast(
        t(existingForTier ? 'staking.toastToppedUp' : 'staking.toastStaked', {
          amount: fmt(parsedAmount),
          tier: tierLabel(selectedTier),
        }),
      );
      await Promise.all([reload(), syncProfile()]);
    } catch (e) {
      setFormError(errMessage(e, t));
    } finally {
      setSubmitting(false);
    }
  }, [
    validate,
    parsedAmount,
    selectedTier,
    existingForTier,
    reload,
    syncProfile,
    t,
    tierLabel,
  ]);

  const onClaim = useCallback(
    async (pos: StakePositionDto) => {
      setBusyId(pos.stakeId);
      setToast(null);
      try {
        const res = await apiClient.claimStake(pos.stakeId);
        setToast(
          res.claimed > 0
            ? t('staking.toastClaimed', { amount: fmt(res.claimed) })
            : t('staking.toastNothingToClaim'),
        );
        await Promise.all([reload(), syncProfile()]);
      } catch (e) {
        setLoadError(errMessage(e, t));
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [reload, syncProfile, t],
  );

  const onUnstake = useCallback(
    async (pos: StakePositionDto, stillLocked: boolean) => {
      if (stillLocked) {
        const penalty = config?.staking[pos.tier]?.earlyPenalty ?? 0;
        const ok = window.confirm(
          t('staking.confirmUnstake', { penalty: ratePct(penalty) }),
        );
        if (!ok) return;
      }
      setBusyId(pos.stakeId);
      setToast(null);
      try {
        const res = await apiClient.unstake(pos.stakeId, stillLocked);
        const parts = [t('staking.toastReturned', { amount: fmt(res.returned) })];
        if (res.claimed > 0)
          parts.push(t('staking.toastYield', { amount: fmt(res.claimed) }));
        if (res.penalized) parts.push(t('staking.toastPenalty'));
        setToast(`${parts.join(' ')}.`);
        await Promise.all([reload(), syncProfile()]);
      } catch (e) {
        setLoadError(errMessage(e, t));
        // Refresh to reflect server truth (e.g. already-closed positions).
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [config, reload, syncProfile, t],
  );

  const onBoost = useCallback(
    async (pos: StakePositionDto, boost: StakingBoost) => {
      setBusyId(pos.stakeId);
      setToast(null);
      try {
        await apiClient.boostStake(pos.stakeId, boost);
        setToast(
          t('staking.boostLevelUp', {
            label: t(`staking.boostMeta.${boost}.label`),
          }),
        );
        await Promise.all([reload(), syncProfile()]);
      } catch (e) {
        setLoadError(errMessage(e, t));
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [reload, syncProfile, t],
  );

  // Auto-dismiss the success toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const formValidation = validate();

  return (
    <div className={`screen ${styles.screenVars}`}>
      <h1 className="screen__title">{t('staking.title')}</h1>

      {/* ── Balance hero ── */}
      <div className={`card ${styles.balanceCard}`}>
        <div className={styles.balanceTop}>
          <div className={styles.balanceLeft}>
            <span className={styles.balanceLabel}>
              {t('staking.availableBalance')}
            </span>
            <span className={styles.balanceRow}>
              <CoinIcon size={30} className={styles.balanceCoin} />
              <span className={`${styles.balanceValue} num`}>{fmt(coins)}</span>
            </span>
          </div>
          <span className={styles.vaultBadge} aria-hidden="true">
            <VaultIcon size={26} />
          </span>
        </div>
        {hasPositions && (
          <div className={styles.balanceStats}>
            <div className={styles.balanceStat}>
              <span className={styles.balanceStatLabel}>
                {t('staking.staked')}
              </span>
              <span className={styles.balanceStatRow}>
                <CoinIcon size={15} />
                <span className={`${styles.balanceStatValue} num`}>{fmt(totalStaked)}</span>
              </span>
            </div>
            <div className={styles.balanceStatDivider} aria-hidden="true" />
            <div className={styles.balanceStat}>
              <span className={styles.balanceStatLabel}>
                {t('staking.yieldPerDay')}
              </span>
              <span className={styles.balanceStatRow}>
                <span className={`${styles.balanceStatValue} ${styles.balanceStatAccent} num`}>
                  +{fmt(totalDaily)}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className={styles.toast}>
          <CheckIcon size={16} className={styles.toastIcon} />
          <span>{toast}</span>
        </div>
      )}

      {/* ── Tier selection ── */}
      <div className={styles.sectionTitle}>{t('staking.chooseTier')}</div>
      <div className={styles.tiers}>
        {STAKING_TIERS.map((tier) => {
          const c = config?.staking[tier];
          const sel = tier === selectedTier;
          const locked = c ? c.termDays > 0 : false;
          return (
            <button
              key={tier}
              type="button"
              className={`${styles.tier} ${sel ? styles.tierSelected : ''}`}
              onClick={() => {
                setSelectedTier(tier);
                setFormError(null);
              }}
              aria-pressed={sel}
            >
              <span className={styles.tierTop}>
                <span className={styles.tierName}>{tierLabel(tier)}</span>
                <span className={styles.tierGlyph} aria-hidden="true">
                  {locked ? <LockIcon size={16} /> : <FlameIcon size={16} />}
                </span>
              </span>
              <span className={styles.tierRateRow}>
                <span className={`${styles.tierRate} num`}>{c ? ratePct(c.rateDaily) : '—'}</span>
                <span className={styles.tierRateUnit}>{t('staking.perDay')}</span>
              </span>
              <span className={styles.tierMeta}>
                <span className={styles.tierMetaRow}>
                  {c ? termLabel(c.termDays, t) : ''}
                </span>
                <span className={`${styles.tierMetaRow} num`}>
                  {c ? t('staking.min', { amount: fmt(c.minStake) }) : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Stake form ── */}
      <div className="card">
        <div className={styles.form}>
          <div className={styles.amountRow}>
            <span className={styles.inputWrap}>
              <CoinIcon size={20} className={styles.inputCoin} />
              <input
                className={`${styles.input} num`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                aria-label={t('staking.amountAriaLabel')}
                placeholder={
                  minStake
                    ? t('staking.minPlaceholder', { amount: fmt(minStake) })
                    : t('staking.amountPlaceholder')
                }
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (formError) setFormError(null);
                }}
                disabled={submitting}
              />
            </span>
            <button
              type="button"
              className={styles.maxBtn}
              onClick={() => {
                setAmount(String(coins));
                setFormError(null);
              }}
              disabled={submitting || coins <= 0}
            >
              MAX
            </button>
          </div>

          <div className={styles.formMeta}>
            <span className="num">
              {t('staking.formMeta', {
                amount: fmt(minStake),
                rate: tierCfg ? ratePct(tierCfg.rateDaily) : '—',
              })}
            </span>
            <span className="num">
              {t('staking.positions', {
                active: activeCount,
                total: STAKING_TIERS.length,
              })}
            </span>
          </div>

          {formError && <p className={styles.formError}>{formError}</p>}

          <button
            type="button"
            className={`btn btn--block ${styles.wide}`}
            onClick={onStake}
            disabled={submitting || !!formValidation}
          >
            {submitting
              ? t('staking.stakingInProgress')
              : existingForTier
                ? t('staking.topUp', { tier: tierLabel(selectedTier) })
                : t('staking.stake', { tier: tierLabel(selectedTier) })}
          </button>
        </div>
      </div>

      {/* ── Active positions ── */}
      <div className={styles.sectionTitle}>{t('staking.activePositions')}</div>

      {positions === null && !loadError && (
        <div className={styles.center}>
          <div className="spinner" />
        </div>
      )}

      {loadError && positions === null && (
        <div className={styles.errorBox}>
          {loadError}
          <div className={styles.errorActions}>
            <button type="button" className="btn" onClick={() => void reload()}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      )}

      {positions !== null && positions.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <VaultIcon size={30} />
          </span>
          <span>{t('staking.noPositions')}</span>
        </div>
      )}

      {positions && positions.length > 0 && (
        <div className={styles.positions}>
          {loadError && <div className={styles.formError}>{loadError}</div>}
          {positions.map((pos) => {
            const locked = pos.unlockAt !== null;
            const stillLocked = locked && new Date(pos.unlockAt as string).getTime() > now;
            const busy = busyId === pos.stakeId;
            const rate = Number(pos.rateDaily);
            const cap = pos.capacity > 0 ? pos.capacity : 0;

            // Optimistic storage: extrapolate from the server measurement.
            const stored = stakeAccrual(
              pos.amount,
              rate,
              now - fetchedAt,
              pos.storageAccrued,
              cap,
            );
            const fillPct = cap > 0 ? Math.min(100, Math.round((stored / cap) * 100)) : 0;
            const full = cap > 0 && stored >= cap;
            const canClaim = stored > 0 && !busy;

            return (
              <div key={pos.stakeId} className={styles.position}>
                <div className={styles.posHead}>
                  <span className={styles.posTier}>
                    <span className={styles.posTierIcon} aria-hidden="true">
                      <VaultIcon size={18} />
                    </span>
                    {tierLabel(pos.tier)}
                    <span
                      className={`${styles.badge} ${locked ? styles.badgeLocked : styles.badgeFlex}`}
                    >
                      {locked ? (
                        <>
                          <LockIcon size={11} /> {t('staking.locked')}
                        </>
                      ) : (
                        <>
                          <FlameIcon size={11} /> {t('staking.flexible')}
                        </>
                      )}
                    </span>
                  </span>
                  <span className={`${styles.posRate} num`}>
                    {Number.isFinite(rate) ? ratePct(rate) : pos.rateDaily}
                    {t('staking.perDay')}
                  </span>
                </div>

                <div className={styles.posGrid}>
                  <div className={styles.posCell}>
                    <span className={styles.posCellLabel}>
                      {t('staking.principal')}
                    </span>
                    <span className={styles.posCellRow}>
                      <CoinIcon size={16} className={styles.posCellCoin} />
                      <span className={`${styles.posCellValue} num`}>{fmt(pos.amount)}</span>
                    </span>
                  </div>
                  <div className={styles.posCell}>
                    <span className={styles.posCellLabel}>
                      {stored > 0 && !full && (
                        <span className={styles.liveDot} aria-hidden="true" />
                      )}
                      {t('staking.storage')}
                      {full && (
                        <span className={`${styles.badge} ${styles.badgeLocked}`}>
                          {t('staking.full')}
                        </span>
                      )}
                    </span>
                    <span className={`${styles.posCellValue} ${styles.accrued} num`}>
                      +{fmt(stored)}
                    </span>
                  </div>
                </div>

                {cap > 0 && (
                  <div className={styles.vault}>
                    <div
                      className={styles.vaultBar}
                      role="progressbar"
                      aria-label={t('staking.storageFillAria')}
                      aria-valuenow={fillPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span
                        className={`${styles.vaultFill} ${full ? styles.vaultFull : ''}`}
                        style={{ transform: `scaleX(${fillPct / 100})` }}
                      />
                      {stored > 0 && !full && (
                        <span
                          className={styles.vaultShimmerClip}
                          style={{ width: `${fillPct}%` }}
                          aria-hidden="true"
                        >
                          <span className={styles.vaultSheen} />
                        </span>
                      )}
                    </div>
                    <span className={`${styles.vaultMeta} num`}>
                      {fmt(stored)} / {fmt(cap)}
                    </span>
                  </div>
                )}

                <div className={styles.posActions}>
                  <button
                    type="button"
                    className={`btn btn--block ${styles.claimBtn}`}
                    onClick={() => void onClaim(pos)}
                    disabled={!canClaim}
                  >
                    {busy
                      ? t('staking.working')
                      : t('staking.claim', { amount: fmt(stored) })}
                  </button>
                  <button
                    type="button"
                    className={`btn btn--block ${styles.unstakeBtn} ${stillLocked ? styles.unstakeLocked : ''}`}
                    onClick={() => void onUnstake(pos, stillLocked)}
                    disabled={busy}
                  >
                    {stillLocked ? (
                      <span className={styles.lockedLabel}>
                        <LockIcon size={15} />
                        {untilLabel(pos.unlockAt as string, now, t)}
                      </span>
                    ) : (
                      t('staking.unstake')
                    )}
                  </button>
                </div>

                {stillLocked && (
                  <p className={styles.unlockHint}>
                    <ClockIcon size={13} className={styles.unlockHintIcon} />
                    {t('staking.earlyExitHint')}
                  </p>
                )}

                {config && (
                  <div className={styles.boosts}>
                    <div className={styles.boostsHead}>
                      <BoostsIcon size={14} />
                      <span>{t('staking.positionBoosts')}</span>
                    </div>
                    <div className={styles.boostList}>
                      {STAKING_BOOSTS.map((boost) => {
                        const Icon = BOOST_ICONS[boost];
                        const bc = config.stakingBoosts[boost];
                        const level = pos.boosts[boost];
                        const maxed = level >= bc.maxLevel;
                        const price = maxed
                          ? null
                          : stakeBoostPrice(boost, level, config);
                        const affordable = price !== null && coins >= price;
                        return (
                          <div key={boost} className={styles.boost}>
                            <span className={styles.boostIcon} aria-hidden="true">
                              <Icon size={16} />
                            </span>
                            <span className={styles.boostInfo}>
                              <span className={styles.boostName}>
                                {t(`staking.boostMeta.${boost}.label`)}
                                <span className={`${styles.boostLvl} num`}>
                                  {level}/{bc.maxLevel}
                                </span>
                              </span>
                              <span className={styles.boostEffect}>
                                {boostEffectLabel(boost, level, bc.perLevel, t)}
                              </span>
                            </span>
                            <button
                              type="button"
                              className={styles.boostBuy}
                              onClick={() => void onBoost(pos, boost)}
                              disabled={busy || maxed || !affordable}
                            >
                              {maxed ? (
                                'MAX'
                              ) : (
                                <span className={styles.boostBuyInner}>
                                  <CoinIcon size={13} />
                                  <span className="num">{fmt(price as number)}</span>
                                </span>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
