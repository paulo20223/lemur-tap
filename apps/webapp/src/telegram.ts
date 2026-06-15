/**
 * Telegram Mini App integration via @telegram-apps/sdk-react (v2.x).
 *
 * Responsibilities:
 *  - init the SDK once,
 *  - mount + signal ready() and expand() the viewport,
 *  - expose the raw initData query string (sent to POST /auth/telegram) and a
 *    light view of the Telegram user for the UI.
 *
 * Outside of Telegram (e.g. running `pnpm dev:webapp` in a desktop browser) the
 * SDK has no environment to read; we degrade gracefully so the shell still
 * boots and screen agents can develop. A real device/Telegram client always
 * provides initData.
 */
import {
  init as initSdk,
  retrieveLaunchParams,
  miniApp,
  viewport,
} from '@telegram-apps/sdk-react';

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  isPremium: boolean;
  languageCode?: string;
  /** URL of the user's Telegram profile photo, when shared by the client. */
  photoUrl?: string;
}

export interface TelegramContext {
  /** Raw initData query string for POST /auth/telegram, or '' when unavailable. */
  initDataRaw: string;
  /**
   * `tgWebAppStartParam` launch param (the `startapp` deep-link payload), or null.
   * Forwarded to auth because Telegram does not reliably embed it in the signed
   * initData on every client — needed for referral attribution.
   */
  startParam: string | null;
  user: TelegramUser | null;
  /** True when running inside a real Telegram environment. */
  isTelegram: boolean;
}

let cached: TelegramContext | null = null;

/**
 * Initialize the SDK, mount the mini app, mark it ready and expand the viewport.
 * Idempotent: safe to call once during bootstrap.
 */
export async function initTelegram(): Promise<TelegramContext> {
  if (cached) return cached;

  try {
    initSdk();

    // Mount + ready the mini app so Telegram stops showing its splash.
    if (miniApp.mount.isAvailable()) {
      miniApp.mount();
    }
    if (miniApp.ready.isAvailable()) {
      miniApp.ready();
    }

    // Expand to full height for a game-like full-screen layout.
    // NB: viewport.mount() can hang forever on Telegram for macOS (the desktop
    // client never answers the request the SDK awaits), so we must NOT block
    // bootstrap on it — otherwise React never mounts and the app shows a blank
    // screen. Fire-and-forget; expand once/if it resolves.
    if (viewport.mount.isAvailable()) {
      void viewport
        .mount()
        .then(() => {
          if (viewport.expand.isAvailable()) viewport.expand();
        })
        .catch(() => undefined);
    } else if (viewport.expand.isAvailable()) {
      viewport.expand();
    }

    const lp = retrieveLaunchParams();
    const initDataRaw = lp.initDataRaw ?? '';
    const startParam = lp.startParam ?? null;
    const tgUser = lp.initData?.user;

    const user: TelegramUser | null = tgUser
      ? {
          id: tgUser.id,
          firstName: tgUser.firstName,
          lastName: tgUser.lastName,
          username: tgUser.username,
          isPremium: Boolean(tgUser.isPremium),
          languageCode: tgUser.languageCode,
          photoUrl: tgUser.photoUrl,
        }
      : null;

    cached = { initDataRaw, startParam, user, isTelegram: initDataRaw.length > 0 };
    return cached;
  } catch {
    // Not inside Telegram — provide an empty context. Auth will fail until run
    // inside a real client; this only keeps the dev shell from crashing.
    cached = { initDataRaw: '', startParam: null, user: null, isTelegram: false };
    return cached;
  }
}

/** Synchronous accessor after initTelegram() has resolved. */
export function getTelegramContext(): TelegramContext {
  return (
    cached ?? { initDataRaw: '', startParam: null, user: null, isTelegram: false }
  );
}
