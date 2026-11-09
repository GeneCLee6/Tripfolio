import { useMemo, useSyncExternalStore } from 'react'
import {
  detectLocale,
  getLocale,
  isLocale,
  setLocale as setCoreLocale,
  subscribeLocale,
  t,
  tp,
  type Locale,
  type MessageKey,
  type MessageParams,
  type PluralKey,
} from '../../shared/i18n/core.ts'

// The browser side of i18n (e10-t02): first-visit detection, the stored choice, <html lang>, and the
// React hooks. t() itself is in shared/i18n/core.ts; the catalogs are registered by the entry
// (shared/i18n/t.ts for the app, share/catalog.ts for the share page).

const STORAGE_KEY = 'tripfolio.locale'

function readStored(storageKey: string): Locale | null {
  try {
    const stored = localStorage.getItem(storageKey)
    return isLocale(stored) ? stored : null
  } catch {
    return null
  }
}

function applyToDocument(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
}

/**
 * Picks the locale before the first render: the stored choice, or on a first visit the browser's
 * languages (non-Chinese gets English). Keeps <html lang> in step afterwards. `storageKey` lets the
 * share page remember its language separately (DESIGN.md §5.8).
 */
export function initLocale(storageKey: string = STORAGE_KEY): Locale {
  const locale = readStored(storageKey) ?? detectLocale(globalThis.navigator?.languages)
  setCoreLocale(locale)
  applyToDocument(locale)
  subscribeLocale(applyToDocument)
  return locale
}

/** Switches the interface language and remembers it */
export function setLocale(locale: Locale, storageKey: string = STORAGE_KEY): void {
  try {
    localStorage.setItem(storageKey, locale)
  } catch {
    // Storage disabled: the choice lasts for this page only
  }
  setCoreLocale(locale)
}

const subscribe = (listener: () => void) => subscribeLocale(listener)

/** The current locale and its setter; the component re-renders when the language changes */
export function useLocale(): [Locale, (locale: Locale) => void] {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale)
  return [locale, setLocale]
}

export interface Translate {
  (key: MessageKey, params?: MessageParams): string
  /** Count messages: `t.plural('count.stops', 3)` */
  plural: (key: PluralKey, count: number, params?: MessageParams) => string
  locale: Locale
}

/** t() bound to the current locale; components that use it re-render on a language switch */
export function useT(): Translate {
  const [locale] = useLocale()
  return useMemo(
    () =>
      Object.assign((key: MessageKey, params?: MessageParams) => t(key, params, locale), {
        plural: (key: PluralKey, count: number, params?: MessageParams) =>
          tp(key, count, params, locale),
        locale,
      }),
    [locale],
  )
}
