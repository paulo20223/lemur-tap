/**
 * Language switcher — a two-option pill (Русский / English) for the Profile page.
 *
 * Reads/writes the active locale through the i18n context; the choice persists
 * to localStorage there. Styled with the Profile page's shared `--ref-*` tokens
 * so it reads as part of the same "quiet luxury" surface.
 */
import { LOCALES, useI18n, type Locale } from '../i18n';
import './language-switcher.css';

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <section className="ref-sheet lang">
      <p className="ref-eyebrow">{t('language.label')}</p>
      <div
        className="lang__group"
        role="radiogroup"
        aria-label={t('language.label')}
      >
        {LOCALES.map((code) => {
          const selected = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? 'lang__opt lang__opt--on' : 'lang__opt'}
              onClick={() => setLocale(code as Locale)}
            >
              {t(`language.${code}`)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
