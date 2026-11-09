import { en } from './en.ts'
import { zhTW, type MessageKey } from './zh-TW.ts'

// The translation core: catalogs, the current locale, t() and tp(). Pure (no React, no DOM, no
// storage) so the Worker and tests can use it; the React hooks, browser detection and the stored
// choice live in src/lib/i18n.ts.

export type Locale = 'zh-TW' | 'en'
/** Older name for Locale, kept for existing callers */
export type Language = Locale
export type MessageParams = Record<string, string | number>
export type { MessageKey }

/** Supported locales, in switcher order; zh-TW is the source and the default (DESIGN.md §5) */
export const LOCALES: readonly Locale[] = ['zh-TW', 'en']
export const DEFAULT_LOCALE: Locale = 'zh-TW'

/** The base of every plural pair in the catalog: `count.stops` for `count.stops.one`/`.other` */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}.other`
    ? Base
    : never
  : never

const catalogs: Record<Locale, Record<MessageKey, string>> = { 'zh-TW': zhTW, en }

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<(locale: Locale) => void>()

export const isLocale = (value: unknown): value is Locale => value === 'zh-TW' || value === 'en'

export const getLocale = (): Locale => current

/** Changes the current locale and tells subscribers (the React hooks re-render on it) */
export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  for (const listener of listeners) listener(locale)
}

/** Calls `listener` after every locale change; returns the unsubscribe function */
export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getLanguage = getLocale
export const setLanguage = setLocale

/**
 * The locale for a first visit from the browser's preferred languages (DESIGN.md §5.8): Chinese of
 * any kind gets zh-TW, anything else English; no information keeps the default.
 */
export function detectLocale(languages: readonly string[] | undefined): Locale {
  const first = languages?.find((language) => language.trim() !== '')
  if (!first) return DEFAULT_LOCALE
  return first.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

/** Fills {name} placeholders; an unknown placeholder is left as written so that it shows up */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  )
}

/** The message for `key` in the current locale (or `locale`); falls back to zh-TW, then the key */
export function t(key: MessageKey, params?: MessageParams, locale: Locale = current): string {
  return interpolate(catalogs[locale][key] ?? catalogs[DEFAULT_LOCALE][key] ?? key, params)
}

const pluralRules = new Map<Locale, Intl.PluralRules>()

/**
 * A count message: picks `<key>.one`/`<key>.other` with Intl.PluralRules and fills {count} with the
 * locale's number format (other params pass through). Categories the catalog lacks fall to `other`.
 */
export function tp(
  key: PluralKey,
  count: number,
  params?: MessageParams,
  locale: Locale = current,
): string {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  const category = rules.select(count)
  const candidate = `${key}.${category}`
  const messageKey = (candidate in catalogs[locale] ? candidate : `${key}.other`) as MessageKey
  return t(
    messageKey,
    { ...params, count: new Intl.NumberFormat(locale).format(count) },
    locale,
  )
}
