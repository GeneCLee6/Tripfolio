import { initLocale, setLocale } from '../src/lib/i18n.ts'
import type { Locale } from '../shared/i18n/core.ts'

// The share page remembers its language apart from the app (DESIGN.md §5.8): a friend who reads a
// shared trip in English does not switch the app on the same device, and the other way round.

export const SHARE_LOCALE_KEY = 'tripfolio.share.locale'

export const initShareLocale = (): Locale => initLocale(SHARE_LOCALE_KEY)

export const setShareLocale = (locale: Locale): void => setLocale(locale, SHARE_LOCALE_KEY)
