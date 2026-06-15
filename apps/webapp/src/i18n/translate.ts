/**
 * Pure translation runtime: resolve a dot-path key in a dictionary, pick the
 * plural form for the active locale, and interpolate `{placeholder}` params.
 *
 * No React here — `I18nProvider` binds these to the active locale, and this
 * stays trivially testable in isolation.
 */
import type { Locale, Plural, TParams } from './types';

const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/** A plural leaf is an object carrying at least the required `one`/`other` strings. */
function isPlural(value: unknown): value is Plural {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Plural).one === 'string' &&
    typeof (value as Plural).other === 'string'
  );
}

/** Replace every `{key}` with `params[key]`; unknown placeholders are left intact. */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** Walk a dot-path (`a.b.c`) into a nested dictionary; `undefined` if absent. */
export function resolve(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

/**
 * Resolve `key` in `dict` and render it for `locale`. Strings interpolate
 * directly; plural leaves select a form by `params.count`. A missing key
 * degrades visibly to the key itself (so gaps surface in the UI, not as blanks).
 */
export function translate(
  locale: Locale,
  dict: unknown,
  key: string,
  params?: TParams,
): string {
  const node = resolve(dict, key);

  if (typeof node === 'string') return interpolate(node, params);

  if (isPlural(node)) {
    const count = typeof params?.count === 'number' ? params.count : 0;
    const form = pluralRules(locale).select(count);
    const value = node[form as keyof Plural] ?? node.other ?? node.one;
    return interpolate(value, params);
  }

  return key;
}
