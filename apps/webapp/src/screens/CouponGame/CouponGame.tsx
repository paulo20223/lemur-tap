/**
 * Coupon Catch mini-game — the home screen (spec/app/06).
 *
 * Flow:
 *   1. Player taps "Play" -> apiClient.couponStart() (energy spent server-side).
 *   2. A 30s round runs in a 2D scene (scene2d.ts): coupons fall deterministically
 *      from the server seed (engine.ts); the player drags the lemur's basket to
 *      catch them, accumulating score.
 *   3. On timeout -> apiClient.couponFinish(sessionId, score) -> reward + new
 *      coin balance, written back into the global store.
 *
 * Server stays authoritative: energy is reconciled from the store snapshot, and
 * the finish response overwrites the displayed coin balance. Leaving the screen
 * mid-round abandons the session (energy already spent).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store';
import { apiClient, ApiClientError } from '../../api/client';
import { ERROR_CODES } from '@lemur/shared';
import { ClockIcon, TrophyIcon, EnergyIcon, CoinIcon, GiftIcon } from '../../components/icons';
import { useT, type MessageKey } from '../../i18n';
import { buildSpawnSchedule, type SpawnSpec } from './engine';
import { createScene, type SceneHandle } from './scene2d';
import { skinVariant, resolveSkinId } from '../Shop/skins';
import styles from './CouponGame.module.css';

type Phase = 'idle' | 'countdown' | 'playing' | 'finishing' | 'result';

type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Map a server error code to a localized, player-facing message. */
function friendlyError(code: string, t: TFn): string {
  switch (code) {
    case ERROR_CODES.INSUFFICIENT_ENERGY:
      return t('coupon.errors.insufficientEnergy');
    case ERROR_CODES.SESSION_ACTIVE:
      return t('coupon.errors.sessionActive');
    case ERROR_CODES.RATE_LIMITED:
      return t('coupon.errors.rateLimited');
    case ERROR_CODES.SESSION_REJECTED:
      return t('coupon.errors.sessionRejected');
    case ERROR_CODES.SESSION_EXPIRED:
      return t('coupon.errors.sessionExpired');
    case ERROR_CODES.SESSION_NOT_FOUND:
      return t('coupon.errors.sessionNotFound');
    default:
      return t('coupon.errors.generic');
  }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function CouponGame() {
  const t = useT();
  const config = useGameStore((s) => s.config);
  const profile = useGameStore((s) => s.profile);
  const energy = useGameStore((s) => s.energy);
  const applyProfile = useGameStore((s) => s.applyProfile);
  const setEnergyFromServer = useGameStore((s) => s.setEnergyFromServer);
  const equippedSkinId = useGameStore((s) => s.shopCatalog?.equippedSkinId ?? null);
  const basketTier = useGameStore(
    (s) => s.shopCatalog?.basketTier ?? s.profile?.basketTier ?? 0,
  );
  const loadShopCatalog = useGameStore((s) => s.loadShopCatalog);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [reward, setReward] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  // ── Stage + mutable game refs (kept out of React state for the RAF loop) ──
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionRef = useRef<{ sessionId: string; seed: number } | null>(null);
  const scheduleRef = useRef<SpawnSpec[]>([]);
  const spawnIdxRef = useRef(0);
  const scoreRef = useRef(0);
  const startMsRef = useRef(0);
  const lastFrameRef = useRef(0);
  const basketXRef = useRef(0.5);
  const phaseRef = useRef<Phase>('idle');
  const finishRoundRef = useRef<() => void>(() => undefined);
  // Pause bookkeeping for visibility/off-screen.
  const pausedRef = useRef(false);

  // Round length is authoritative from the server (base + active basket bonus,
  // spec/app/13): coupon.start returns the effective durationMs. Before a round
  // starts we show the base config duration as a preview.
  const baseDurationSec = config ? config.couponSessionDurationMs / 1000 : 30;
  const [roundDurationSec, setRoundDurationSec] = useState(baseDurationSec);
  const durationSec = phase === 'idle' ? baseDurationSec : roundDurationSec;
  const cost = config?.couponSessionCost ?? 500;
  const canAfford = energy >= cost;

  // Energy meter: fill toward the cap, with a tick at one round's cost.
  const maxEnergy = profile?.maxEnergy ?? Math.max(energy, cost);
  const energyFill = maxEnergy > 0 ? Math.min(1, energy / maxEnergy) : 0;
  const costFrac = maxEnergy > 0 ? Math.min(1, cost / maxEnergy) : 0;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Ensure the shop catalog (which carries equippedSkinId) is loaded so the
  // lemur renders in the player's chosen skin. Best-effort; failure is silent
  // (the lemur just shows the default look).
  useEffect(() => {
    if (equippedSkinId === null) void loadShopCatalog().catch(() => undefined);
    // Load once on mount if not already present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the equipped cosmetic skin to the lemur catcher whenever it changes
  // (and on first scene mount). Graceful fallback to 'classic'.
  useEffect(() => {
    const skinId = resolveSkinId(equippedSkinId);
    sceneRef.current?.setSkin(skinId, skinVariant(skinId).accent);
  }, [equippedSkinId]);

  // Recolour the woven basket to the active tier's metal (wicker/silver/gold).
  useEffect(() => {
    sceneRef.current?.setBasket(basketTier);
  }, [basketTier]);

  // ── Create the 2D scene once the stage mounts ───────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handle = createScene(stage, {
      reducedMotion: prefersReducedMotion(),
      classes: {
        field: styles.field ?? '',
        coupon: styles.coupon ?? '',
        couponLogo: styles.couponLogo ?? '',
        couponName: styles.couponName ?? '',
        couponDivider: styles.couponDivider ?? '',
        couponBadge: styles.couponBadge ?? '',
        catcher: styles.catcher ?? '',
        pop: styles.pop ?? '',
        burst: styles.burst ?? '',
      },
      onScore: (points) => {
        scoreRef.current += points;
        setScore(scoreRef.current);
      },
    });
    sceneRef.current = handle;

    // Apply the currently-equipped skin straight away (the dedicated effect may
    // have run before the scene existed on first mount).
    const snapshot = useGameStore.getState();
    const skinId = resolveSkinId(snapshot.shopCatalog?.equippedSkinId);
    handle.setSkin(skinId, skinVariant(skinId).accent);
    handle.setBasket(
      snapshot.shopCatalog?.basketTier ?? snapshot.profile?.basketTier ?? 0,
    );

    const applySize = () => {
      handle.resize(stage.clientWidth, stage.clientHeight);
      handle.render();
    };
    applySize();

    const ro = new ResizeObserver(applySize);
    ro.observe(stage);

    // Pause RAF when the stage scrolls off-screen.
    const io = new IntersectionObserver(
      ([entry]) => {
        pausedRef.current = !entry?.isIntersecting;
      },
      { threshold: 0.01 },
    );
    io.observe(stage);

    return () => {
      ro.disconnect();
      io.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      handle.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ── Pointer / drag controls: move the basket under the finger ──────────────
  const moveBasket = useCallback((clientX: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    basketXRef.current = Math.min(1, Math.max(0, x));
    sceneRef.current?.setBasketX(basketXRef.current);
  }, []);

  // ── The render + physics loop ──────────────────────────────────────────────
  const drawFrame = useCallback(
    (nowMs: number) => {
      const scene = sceneRef.current;
      if (!scene) return;

      // Pause when hidden/off-screen: freeze the round clock by sliding the
      // start time forward, so elapsed doesn't jump on resume (energy is
      // already spent; the round simply waits).
      if (pausedRef.current || document.hidden) {
        const gap = nowMs - lastFrameRef.current;
        if (gap > 0) startMsRef.current += gap;
        lastFrameRef.current = nowMs;
        rafRef.current = requestAnimationFrame(drawFrame);
        return;
      }

      const elapsed = (nowMs - startMsRef.current) / 1000;
      const dt = Math.min(0.05, (nowMs - lastFrameRef.current) / 1000 || 0);
      lastFrameRef.current = nowMs;

      // Spawn any coupon whose scheduled time has arrived.
      const schedule = scheduleRef.current;
      while (spawnIdxRef.current < schedule.length) {
        const spec = schedule[spawnIdxRef.current];
        if (!spec || spec.t > elapsed) break;
        scene.spawnCoupon(spec.brand, spec.x, spec.vy);
        spawnIdxRef.current++;
      }

      scene.update(dt);
      scene.render();

      const remaining = Math.max(0, durationSec - elapsed);
      setTimeLeft(remaining);

      if (elapsed >= durationSec) {
        finishRoundRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(drawFrame);
    },
    [durationSec],
  );

  // ── Finish the round: submit score, show reward ────────────────────────────
  const finishRound = useCallback(async () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const session = sessionRef.current;
    if (!session) {
      setPhase('idle');
      return;
    }
    setPhase('finishing');
    const finalScore = scoreRef.current;
    setScore(finalScore);
    try {
      const res = await apiClient.couponFinish(session.sessionId, finalScore);
      setReward(res.reward);
      const p = useGameStore.getState().profile;
      if (p) applyProfile({ ...p, coins: res.coins });
      setPhase('result');
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : 'unknown_error';
      if (
        code === ERROR_CODES.SESSION_REJECTED ||
        code === ERROR_CODES.SESSION_EXPIRED
      ) {
        setReward(0);
        setError(friendlyError(code, t));
        setPhase('result');
      } else {
        setError(friendlyError(code, t));
        setPhase('idle');
      }
    } finally {
      sessionRef.current = null;
    }
  }, [applyProfile, t]);

  // Keep the RAF-reachable ref pointing at the latest finishRound.
  useEffect(() => {
    finishRoundRef.current = () => void finishRound();
  }, [finishRound]);

  // ── Start a round: couponStart(), run countdown, then the loop ─────────────
  const startRound = useCallback(async () => {
    if (!config || starting || phase === 'playing' || phase === 'countdown') return;
    setError(null);
    setReward(null);
    setStarting(true);
    try {
      const res = await apiClient.couponStart();
      sessionRef.current = { sessionId: res.sessionId, seed: res.seed };
      // Server-authoritative round length (base + active basket bonus).
      const dur = res.durationMs / 1000;
      setRoundDurationSec(dur);
      // Optimistically reflect the energy spend (server already debited it).
      setEnergyFromServer(Math.max(0, energy - cost));

      // Build the deterministic spawn schedule from the server seed.
      scheduleRef.current = buildSpawnSchedule(
        res.seed,
        dur,
        config.couponMaxPointsPerSec,
      );
      spawnIdxRef.current = 0;
      scoreRef.current = 0;
      basketXRef.current = 0.5;
      sceneRef.current?.setBasketX(0.5);
      setScore(0);
      setTimeLeft(dur);
      setCountdown(3);
      setPhase('countdown');
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : 'unknown_error';
      setError(friendlyError(code, t));
      setPhase('idle');
      sessionRef.current = null;
    } finally {
      setStarting(false);
    }
  }, [config, starting, phase, energy, cost, setEnergyFromServer, t]);

  // Countdown 3..2..1 then kick off the RAF loop.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      startMsRef.current = performance.now();
      lastFrameRef.current = startMsRef.current;
      setPhase('playing');
      rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => window.clearTimeout(id);
  }, [phase, countdown, drawFrame]);

  // ── Pointer handlers on the stage ─────────────────────────────────────────
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      moveBasket(e.clientX);
    },
    [moveBasket],
  );
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      moveBasket(e.clientX);
    },
    [moveBasket],
  );

  const playing = phase === 'playing';
  const timerUrgent = playing && timeLeft <= 5;
  const shownTime =
    playing || phase === 'countdown' ? Math.ceil(timeLeft) : durationSec;
  const showRoundHud = playing || phase === 'countdown';

  return (
    <div className={styles.wrap}>
      <div
        className={styles.stage}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {/* The 2D field (lemur + falling coupons) is injected imperatively here. */}

        {/* HUD header — coins pill + a permanent energy meter, always
            visible over the field (including mid-round). */}
        <div className={styles.hudTop}>
          <span className={styles.pill}>
            <CoinIcon size={16} />
            <span>{Math.floor(profile?.coins ?? 0)}</span>
          </span>
          <div
            className={`${styles.energy} ${!canAfford ? styles['energy--low'] : ''}`}
            role="meter"
            aria-label={t('coupon.energy')}
            aria-valuemin={0}
            aria-valuemax={maxEnergy}
            aria-valuenow={Math.floor(energy)}
          >
            <span className={styles.energyIcon} aria-hidden>
              <EnergyIcon size={13} />
            </span>
            <span className={styles.energyTrack}>
              <span
                className={styles.energyFill}
                style={{ transform: `scaleX(${energyFill})` }}
              />
              {costFrac < 1 && (
                <span
                  className={styles.energyTick}
                  style={{ left: `${costFrac * 100}%` }}
                  aria-hidden
                />
              )}
            </span>
            <span className={styles.energyValue}>
              {Math.floor(energy)}
              <span className={styles.energyMax}>/{maxEnergy}</span>
            </span>
          </div>
        </div>

        {/* In-round HUD — score + timer. */}
        {showRoundHud && (
          <div className={styles.hudRound}>
            <div className={styles.hudItem}>
              <span className={styles.hudIcon} aria-hidden>
                <TrophyIcon size={16} />
              </span>
              <span className={styles.hudText}>
                <span className={styles.hudLabel}>{t('coupon.score')}</span>
                <span className={styles.hudValue}>{score}</span>
              </span>
            </div>
            <div
              className={`${styles.hudItem} ${timerUrgent ? styles['timer--urgent'] : ''}`}
            >
              <span className={styles.hudIcon} aria-hidden>
                <ClockIcon size={16} />
              </span>
              <span className={styles.hudText}>
                <span className={styles.hudLabel}>{t('coupon.time')}</span>
                <span className={styles.hudValue}>
                  {t('coupon.seconds', { value: shownTime })}
                </span>
              </span>
            </div>
          </div>
        )}

        {phase === 'idle' && (
          <div className={styles.startSheet}>
            <span className={styles.overlayBadge} aria-hidden>
              <GiftIcon size={30} />
            </span>
            <h2 className={styles.overlayTitle}>{t('coupon.title')}</h2>
            <p className={styles.overlayText}>
              {t('coupon.description', { seconds: durationSec })}
            </p>

            {error && (
              <p className={`${styles.overlayText} ${styles.overlayError}`}>
                {error}
              </p>
            )}
            <div className={styles.perf} aria-hidden />
            <button
              className="btn btn--block"
              onClick={startRound}
              disabled={!config || !canAfford || starting}
            >
              {starting ? t('coupon.starting') : t('coupon.play', { cost })}
            </button>
            {!canAfford && config && (
              <p className={styles.cost}>
                {t('coupon.needEnergy', { cost, have: Math.floor(energy) })}
              </p>
            )}
            {!config && (
              <p className={styles.hint}>{t('coupon.loadingConfig')}</p>
            )}
          </div>
        )}

        {phase === 'countdown' && (
          <div className={`${styles.overlay} ${styles.overlayBare}`}>
            <div key={countdown} className={styles.countdownNum}>
              {countdown > 0 ? countdown : t('coupon.go')}
            </div>
          </div>
        )}

        {phase === 'finishing' && (
          <div className={styles.overlay}>
            <div className={styles.overlayCard}>
              <div className="spinner" />
              <p className={styles.overlayText}>{t('coupon.tallying')}</p>
            </div>
          </div>
        )}

        {phase === 'result' && (
          <div className={styles.overlay}>
            <div className={styles.overlayCard}>
              <span
                className={`${styles.overlayBadge} ${(reward ?? 0) > 0 ? styles['overlayBadge--win'] : ''}`}
                aria-hidden
              >
                <TrophyIcon size={30} />
              </span>
              <div className={styles.rewardBlock}>
                <span className={styles.rewardLabel}>{t('coupon.reward')}</span>
                <div
                  className={`${styles.reward} ${(reward ?? 0) > 0 ? '' : styles['reward--zero']}`}
                >
                  <span className={styles.rewardCoin} aria-hidden>
                    <CoinIcon size={32} />
                  </span>
                  +{reward ?? 0}
                </div>
              </div>
              <p className={styles.overlayText}>
                {t('coupon.finalScore', { score })}
              </p>
              {error && (
                <p className={`${styles.overlayText} ${styles.overlayError}`}>
                  {error}
                </p>
              )}
              <div className={styles.perf} aria-hidden />
              <button
                className="btn btn--block"
                onClick={startRound}
                disabled={!canAfford || starting}
              >
                {canAfford
                  ? t('coupon.playAgain', { cost })
                  : t('coupon.outOfEnergy')}
              </button>
              {!canAfford && (
                <p className={styles.cost}>
                  {t('coupon.rechargeHint', { cost })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
