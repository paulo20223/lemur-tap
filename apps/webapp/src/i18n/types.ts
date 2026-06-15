/**
 * i18n core types.
 *
 * The Russian dictionary (`locales/ru.ts`) is the single source of truth: its
 * object literal defines the shape, and `DotPaths<typeof ru>` derives the union
 * of valid, type-safe message keys (e.g. `'staking.title'`). The English
 * dictionary is typed as `Translations<typeof ru>`, which enforces structural
 * parity (same keys, same leaf-vs-namespace split) while letting plural leaves
 * carry the forms each language actually needs.
 */

export type Locale = 'ru' | 'en';

export const LOCALES: readonly Locale[] = ['ru', 'en'];

/**
 * A pluralizable message. `one`/`other` are required (they cover English);
 * `few`/`many`/`two`/`zero` are optional and used where a locale needs them
 * (Russian uses one/few/many). The form is chosen at runtime via
 * `Intl.PluralRules(locale).select(count)`, falling back to `other` then `one`.
 */
export interface Plural {
  one: string;
  other: string;
  few?: string;
  many?: string;
  two?: string;
  zero?: string;
}

/** Interpolation params. `count` (a number) also drives plural selection. */
export type TParams = Record<string, string | number>;

/** Dot-path keys into a dictionary; plural leaves are terminal, not namespaces. */
export type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Plural
      ? K
      : T[K] extends object
        ? `${K}.${DotPaths<T[K]>}`
        : never;
}[keyof T & string];

/**
 * Maps a source dictionary to the shape a translation must have: same keys and
 * the same leaf/namespace structure, but plural leaves only need to satisfy
 * `Plural` (so English can provide one/other where Russian provides one/few/many).
 */
export type Translations<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends Plural
      ? Plural
      : T[K] extends object
        ? Translations<T[K]>
        : never;
};

/** Translation function shape, keyed to a specific source dictionary. */
export type TFunc<Dict> = (key: DotPaths<Dict>, params?: TParams) => string;
