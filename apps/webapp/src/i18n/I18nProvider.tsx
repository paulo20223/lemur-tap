/**
 * i18n React binding: holds the active locale and exposes a `t` bound to it.
 *
 * Mounted ABOVE the boot gate so the loading/error screens translate too. The
 * initial locale is resolved once from a persisted choice, falling back to the
 * Telegram `language_code`, then to Russian (the product's primary language).
 * Switching persists to localStorage so the choice survives reloads.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getTelegramContext } from '../telegram';
import { ru } from './locales/ru';
import { en } from './locales/en';
import { translate } from './translate';
import type { DotPaths, Locale, TParams } from './types';

/** Type-safe message keys derived from the source-of-truth Russian dictionary. */
export type MessageKey = DotPaths<typeof ru>;

const DICTIONARIES: Record<Locale, unknown> = { ru, en };
const STORAGE_KEY = 'lemur.lang';

/** Persisted choice → Telegram language → Russian default. */
function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* localStorage unavailable (private mode / sandbox) — fall through */
  }
  const code = getTelegramContext().user?.languageCode?.toLowerCase();
  if (code?.startsWith('ru')) return 'ru';
  // Inside Telegram with a non-Russian client → English; otherwise default ru.
  return code ? 'en' : 'ru';
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: TParams) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, DICTIONARIES[locale], key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Full i18n handle (locale + switcher + t). */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

/** Just the translation function — the common case in screens. */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}
