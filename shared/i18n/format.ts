import { formatMoney as formatMinor } from '../money/currencies.ts'
import { t, type Locale } from './core.ts'

/** The Intl tag for dates and times: English uses Australian order ("Mon, 9 Nov") because the owner lives in Australia. Money keeps the plain locale so currency symbols stay unambiguous (A$, NZ$, NT$) */
export const dateLocale = (locale: Locale): string => (locale === 'en' ? 'en-AU' : locale)

// Locale-aware formatting (docs/DESIGN.md §5.3, e10-t04). Numbers, dates and times always go through
// Intl; the few word templates (「3 小時 20 分」, "3 h 20 min", the weekday parentheses) are catalog
// messages so they are translated like everything else. Never hand-build these strings in a component.

/** A calendar date as stored (YYYY-MM-DD, no time zone) or an instant shown in `timeZone` */
export type DateInput = string | Date

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const HOURS_MINUTES = /^(\d{1,2}):(\d{2})$/

/** A calendar date is placed at UTC midnight and always formatted in UTC, so it never shifts */
function toInstant(date: DateInput): { instant: Date; dateOnly: boolean } {
  if (date instanceof Date) return { instant: date, dateOnly: false }
  const match = DATE_ONLY.exec(date)
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`)
  const [, year, month, day] = match
  return { instant: new Date(Date.UTC(+year, +month - 1, +day)), dateOnly: true }
}

const zoneFor = (dateOnly: boolean, timeZone?: string): string =>
  dateOnly ? 'UTC' : (timeZone ?? 'UTC')

const number = (value: number, locale: Locale, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(locale, options).format(value)

export interface MoneyFormatOptions {
  /** The same amount in a second currency, shown after it as an approximation */
  secondary?: { minor: number; currency: string }
}

/**
 * An amount in integer minor units, with the currency's symbol and exact decimals (from
 * shared/money/currencies.ts): `A$12.34`, or `A$12.34 (≈ NT$250.00)` with `secondary`.
 */
export function formatMoney(
  minor: number,
  currency: string,
  locale: Locale,
  options: MoneyFormatOptions = {},
): string {
  const primary = formatMinor(minor, currency, locale)
  if (!options.secondary) return primary
  const secondary = formatMinor(options.secondary.minor, options.secondary.currency, locale)
  return t('format.money.withSecondary', { primary, secondary }, locale)
}

export interface DateFormatOptions {
  /** Include the year (default false: trips are short and the year is in the header) */
  year?: boolean
  /** For a Date instant: the IANA zone to show it in (default UTC). Ignored for YYYY-MM-DD. */
  timeZone?: string
}

/** A date with its weekday: zh-TW「11月9日（一）」, en "Mon, Nov 9" */
export function formatDate(date: DateInput, locale: Locale, options: DateFormatOptions = {}): string {
  const { instant, dateOnly } = toInstant(date)
  const timeZone = zoneFor(dateOnly, options.timeZone)
  const zh = locale === 'zh-TW'
  const day = new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    year: options.year ? 'numeric' : undefined,
    month: zh ? 'long' : 'short',
    day: 'numeric',
  }).format(instant)
  const weekday = new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    weekday: zh ? 'narrow' : 'short',
  }).format(instant)
  return t('format.date.withWeekday', { date: day, weekday }, locale)
}

/**
 * A span of dates without weekdays, dropping what the ends share: zh-TW「11月9日 – 14日」, en
 * "Nov 9 – 14"; the year shows only when the ends are in different years.
 */
export function formatDateRange(start: DateInput, end: DateInput, locale: Locale): string {
  const from = toInstant(start)
  const to = toInstant(end)
  const timeZone = zoneFor(from.dateOnly && to.dateOnly)
  const part = (instant: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(dateLocale(locale), { timeZone, ...options }).format(instant)
  const fields = (instant: Date) => part(instant, { year: 'numeric', month: 'numeric', day: 'numeric' })
  const [a, b] = [fields(from.instant), fields(to.instant)]
  if (a === b) return part(from.instant, { month: locale === 'zh-TW' ? 'long' : 'short', day: 'numeric' })
  const sameYear =
    part(from.instant, { year: 'numeric' }) === part(to.instant, { year: 'numeric' })
  const sameMonth = sameYear && part(from.instant, { month: 'numeric' }) === part(to.instant, { month: 'numeric' })
  const month = locale === 'zh-TW' ? 'long' : 'short'
  const year = sameYear ? undefined : 'numeric'
  if (locale !== 'zh-TW') {
    return new Intl.DateTimeFormat(dateLocale(locale), { timeZone, year, month, day: 'numeric' }).formatRange(
      from.instant,
      to.instant,
    )
  }
  // zh-TW's own range pattern is numeric (「11/9至11/14」); the long form reads better
  const left = part(from.instant, { year, month, day: 'numeric' })
  const right = part(to.instant, sameMonth ? { day: 'numeric' } : { year, month, day: 'numeric' })
  return `${left} – ${right}`
}

export interface TimeFormatOptions {
  /** For a Date instant: the IANA zone to show it in (default UTC). Ignored for "HH:mm". */
  timeZone?: string
  /** 12-hour clock; the default is 24-hour */
  hour12?: boolean
}

/** A wall-clock time ("14:05") or an instant in a zone; 24-hour unless asked */
export function formatTime(value: string | Date, locale: Locale, options: TimeFormatOptions = {}): string {
  let instant: Date
  let timeZone = options.timeZone ?? 'UTC'
  if (typeof value === 'string') {
    const match = HOURS_MINUTES.exec(value)
    if (!match || +match[1] > 23 || +match[2] > 59) throw new RangeError(`Not an HH:mm time: ${value}`)
    instant = new Date(Date.UTC(2000, 0, 1, +match[1], +match[2]))
    timeZone = 'UTC'
  } else {
    instant = value
  }
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    hour: options.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: options.hour12 ? 'h12' : 'h23',
  }).format(instant)
}

/** A length of time in whole minutes: zh-TW「3 小時 20 分」, en "3 h 20 min" */
export function formatDuration(minutes: number, locale: Locale): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours > 0 && rest > 0) {
    return t(
      'format.duration.hoursMinutes',
      { hours: number(hours, locale), minutes: number(rest, locale) },
      locale,
    )
  }
  if (hours > 0) return t('format.duration.hours', { hours: number(hours, locale) }, locale)
  return t('format.duration.minutes', { minutes: number(rest, locale) }, locale)
}

/** A distance in meters: whole meters under 1 km, else km with at most one decimal ("95 km", "12.3 km") */
export function formatDistance(meters: number, locale: Locale): string {
  const value = Math.max(0, meters)
  if (Math.round(value) < 1000) {
    return t('format.distance.m', { value: number(Math.round(value), locale) }, locale)
  }
  return t(
    'format.distance.km',
    { value: number(value / 1000, locale, { maximumFractionDigits: 1 }) },
    locale,
  )
}

/**
 * The short name of a zone at an instant, as Intl gives it: "PST" for US zones in English, "GMT+13"
 * for Pacific/Auckland (Intl only has abbreviations it can be sure of).
 */
export function formatTzAbbrev(timeZone: string, locale: Locale, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat(dateLocale(locale), { timeZone, timeZoneName: 'short' }).formatToParts(at)
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone
}
