import { en } from './en.ts'
import { zhTW, type MessageKey } from './zh-TW.ts'

// A minimal t() for the skeleton (e11-t01). A2 (e10-t02) adds browser detection, the switch, the
// stored choice and a React hook; keep this signature so callers do not change.

export type Language = 'zh-TW' | 'en'
export type MessageParams = Record<string, string | number>
export type { MessageKey }

const catalogs: Record<Language, Record<MessageKey, string>> = { 'zh-TW': zhTW, en }

// Traditional Chinese is the default interface language (CLAUDE.md)
let current: Language = 'zh-TW'

export const getLanguage = (): Language => current

export function setLanguage(language: Language): void {
  current = language
}

/** Fills {name} placeholders; an unknown placeholder is left as written so that it shows up */
function format(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  )
}

/** The message for `key` in the current language (or `language`); falls back to zh-TW, then the key */
export function t(key: MessageKey, params?: MessageParams, language: Language = current): string {
  return format(catalogs[language][key] ?? catalogs['zh-TW'][key] ?? key, params)
}
