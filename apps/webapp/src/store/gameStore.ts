/**
 * Global client state (zustand).
 *
 * Holds the session profile, live economy config and a client-side energy
 * ticker that mirrors the server's lazy regen via the SHARED economy function
 * (regenEnergy). The server stays authoritative: every mutating response
 * (coupon/etc.) should be written back through `applyProfile` /
 * `setEnergyFromServer`, which resets the local snapshot to the server truth.
 *
 * Screen agents read profile/config/energy from here and call the store's
 * actions to bootstrap; per-feature state (upgrades list, stakes, etc.) is
 * fetched directly via apiClient inside each screen.
 */
import { create } from 'zustand';
import { regenEnergy, type GameConfig, type UserProfileDto } from '@lemur/shared';
import { apiClient } from '../api/client';
import { getTelegramContext } from '../telegram';

export type BootStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Local energy snapshot kept in sync with the shared regen formula. */
interface EnergySnapshot {
  /** Whole stored energy at `energyUpdatedAt`. */
  stored: number;
  /** Epoch-ms the snapshot corresponds to. */
  energyUpdatedAt: number;
  /** Per-user max energy. */
  max: number;
  /** Per-user regen, energy/sec. */
  regenPerSec: number;
}

export interface GameState {
  boot: BootStatus;
  error: string | null;

  profile: UserProfileDto | null;
  config: GameConfig | null;

  /** Displayed energy after client-side regen (whole units). */
  energy: number;
  /** Internal snapshot driving the ticker. */
  energySnapshot: EnergySnapshot | null;

  // ── actions ──
  bootstrap: () => Promise<void>;
  applyProfile: (profile: UserProfileDto) => void;
  setConfig: (config: GameConfig) => void;
  /** Reconcile energy from a server response (coupon/etc.). */
  setEnergyFromServer: (energy: number, energyUpdatedAt?: number) => void;
  /** Optimistically subtract energy locally (e.g. before a coupon start). */
  spendEnergy: (amount: number) => void;
  /** Advance the client-side regen to `now`. Called by the ticker. */
  tickEnergy: (now?: number) => void;
}

function snapshotFromProfile(p: UserProfileDto): EnergySnapshot {
  return {
    stored: p.energy,
    energyUpdatedAt: p.energyUpdatedAt,
    max: p.maxEnergy,
    regenPerSec: p.energyRegen,
  };
}

export const useGameStore = create<GameState>((set, get) => ({
  boot: 'idle',
  error: null,
  profile: null,
  config: null,
  energy: 0,
  energySnapshot: null,

  bootstrap: async () => {
    if (get().boot === 'loading' || get().boot === 'ready') return;
    set({ boot: 'loading', error: null });
    try {
      const tg = getTelegramContext();
      // Auth uses the raw initData captured by initTelegram().
      void tg;
      const [auth, config] = await Promise.all([
        apiClient.authenticate(),
        apiClient.config(),
      ]);
      // Authoritative profile from /me (auth response also carries one).
      const profile = await apiClient.me().catch(() => auth.profile);

      const snap = snapshotFromProfile(profile);
      set({
        profile,
        config,
        energySnapshot: snap,
        energy: snap.stored,
        boot: 'ready',
      });
    } catch (e) {
      set({
        boot: 'error',
        error: e instanceof Error ? e.message : 'Bootstrap failed',
      });
    }
  },

  applyProfile: (profile) => {
    const snap = snapshotFromProfile(profile);
    set({ profile, energySnapshot: snap, energy: snap.stored });
  },

  setConfig: (config) => set({ config }),

  setEnergyFromServer: (energy, energyUpdatedAt) => {
    const prev = get().energySnapshot;
    if (!prev) {
      set({ energy });
      return;
    }
    const snap: EnergySnapshot = {
      ...prev,
      stored: energy,
      energyUpdatedAt: energyUpdatedAt ?? Date.now(),
    };
    set({ energySnapshot: snap, energy });
    // Keep profile.energy roughly in sync for readers of the profile.
    const profile = get().profile;
    if (profile) {
      set({ profile: { ...profile, energy, energyUpdatedAt: snap.energyUpdatedAt } });
    }
  },

  spendEnergy: (amount) => {
    const prev = get().energySnapshot;
    if (!prev) return;
    const stored = Math.max(0, prev.stored - Math.max(0, amount));
    const snap: EnergySnapshot = { ...prev, stored, energyUpdatedAt: Date.now() };
    set({ energySnapshot: snap, energy: stored });
  },

  tickEnergy: (now = Date.now()) => {
    const prev = get().energySnapshot;
    if (!prev) return;
    const next = regenEnergy(
      { stored: prev.stored, energyUpdatedAt: prev.energyUpdatedAt },
      now,
      prev.regenPerSec,
      prev.max,
    );
    if (
      next.stored === prev.stored &&
      next.energyUpdatedAt === prev.energyUpdatedAt
    ) {
      return;
    }
    set({
      energySnapshot: { ...prev, ...next },
      energy: next.stored,
    });
  },
}));

/**
 * Start the global energy ticker. Returns a stop function.
 * Mounted once by App; uses the shared regen formula every second.
 */
export function startEnergyTicker(intervalMs = 1000): () => void {
  const id = window.setInterval(() => {
    useGameStore.getState().tickEnergy();
  }, intervalMs);
  return () => window.clearInterval(id);
}
