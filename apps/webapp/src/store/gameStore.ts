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
import {
  regenEnergy,
  type GameConfig,
  type ShopBasketItem,
  type ShopCatalogResponse,
  type ShopPurchaseResponse,
  type ShopSkinItem,
  type UserProfileDto,
} from '@lemur/shared';
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

  /** Shop catalog (baskets + skins + ownership), lazily loaded. */
  shopCatalog: ShopCatalogResponse | null;

  // ── actions ──
  bootstrap: () => Promise<void>;
  applyProfile: (profile: UserProfileDto) => void;
  setConfig: (config: GameConfig) => void;
  /** Load (or reload) the shop catalog. */
  loadShopCatalog: () => Promise<void>;
  /** Reconcile the coins balance + a touched item from a purchase response. */
  applyShopPurchase: (res: ShopPurchaseResponse) => void;
  /** Equip a skin locally (optimistic), keeping catalog state coherent. */
  applyEquippedSkin: (skinId: string) => void;
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
  shopCatalog: null,

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

  loadShopCatalog: async () => {
    const catalog = await apiClient.shopCatalog();
    set({ shopCatalog: catalog });
  },

  applyShopPurchase: (res) => {
    // Keep the shared coin balance authoritative for every screen + nav.
    const profile = get().profile;
    if (profile) set({ profile: { ...profile, coins: res.coins } });

    const cat = get().shopCatalog;
    if (!cat) return;

    if (res.basket) {
      const bought = res.basket;
      // The active tier is the best owned one; re-derive `active` across all
      // baskets so exactly the top owned tier stays highlighted.
      const baskets: ShopBasketItem[] = cat.baskets.map((b) =>
        b.tier === bought.tier ? bought : b,
      );
      const activeTier = baskets.reduce(
        (best, b) => (b.owned && b.tier > best ? b.tier : best),
        0,
      );
      set({
        shopCatalog: {
          ...cat,
          baskets: baskets.map((b) => ({ ...b, active: b.tier === activeTier })),
          basketTier: activeTier,
        },
      });
    }

    if (res.skin) {
      const bought = res.skin;
      const skins: ShopSkinItem[] = cat.skins.map((s) =>
        s.id === bought.id ? bought : s,
      );
      // A buy doesn't auto-equip; only mirror an explicit `equipped` flag.
      const equippedSkinId = bought.equipped ? bought.id : cat.equippedSkinId;
      set({
        shopCatalog: {
          ...cat,
          skins: equippedSkinId
            ? skins.map((s) => ({ ...s, equipped: s.id === equippedSkinId }))
            : skins,
          equippedSkinId,
        },
      });
    }
  },

  applyEquippedSkin: (skinId) => {
    const cat = get().shopCatalog;
    if (!cat) return;
    set({
      shopCatalog: {
        ...cat,
        equippedSkinId: skinId,
        skins: cat.skins.map((s) => ({ ...s, equipped: s.id === skinId })),
      },
    });
  },

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
