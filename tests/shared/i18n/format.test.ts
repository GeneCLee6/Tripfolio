import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateRange,
  formatDistance,
  formatDuration,
  formatMoney,
  formatTime,
  formatTzAbbrev,
} from '../../../shared/i18n/format.ts'
// format.ts uses the catalog-free core; this registers the app catalog its templates come from
import '../../../shared/i18n/t.ts'

// Intl puts thin (U+2009) and narrow no-break (U+202F) spaces in ranges and 12-hour times
const plain = (text: string) => text.replace(/[  ]/g, ' ')

describe('formatMoney', () => {
  it('uses the currency decimals from the currency table', () => {
    expect(formatMoney(4250, 'AUD', 'en')).toBe('A$42.50')
    expect(formatMoney(4250, 'AUD', 'zh-TW')).toBe('AU$42.50')
    // IDR has no minor unit: 150000 minor units are 150,000 rupiah (Intl puts a no-break space)
    expect(formatMoney(150000, 'IDR', 'en')).toBe('IDR 150,000')
    expect(formatMoney(-1234567, 'NZD', 'en')).toBe('-NZ$12,345.67')
  })

  it('adds the secondary currency as an approximation', () => {
    const secondary = { minor: 88690, currency: 'TWD' }
    expect(formatMoney(4250, 'AUD', 'en', { secondary })).toBe('A$42.50 (≈ NT$886.90)')
    expect(formatMoney(4250, 'AUD', 'zh-TW', { secondary })).toBe('AU$42.50（≈ $886.90）')
  })
})

describe('formatDate', () => {
  it('shows a stored date with its weekday', () => {
    expect(formatDate('2026-11-09', 'zh-TW')).toBe('11月9日（一）')
    expect(formatDate('2026-11-09', 'en')).toBe('Mon, 9 Nov')
    expect(formatDate('2026-11-08', 'zh-TW')).toBe('11月8日（日）')
    expect(formatDate('2026-11-08', 'en')).toBe('Sun, 8 Nov')
  })

  it('adds the year on request', () => {
    expect(formatDate('2026-11-09', 'zh-TW', { year: true })).toBe('2026年11月9日（一）')
    expect(formatDate('2026-11-09', 'en', { year: true })).toBe('Mon, 9 Nov 2026')
  })

  it('shows an instant in the given zone, not the machine zone', () => {
    // 12:00 UTC on the 8th is already the 9th in Auckland (UTC+13)
    const instant = new Date('2026-11-08T12:00:00Z')
    expect(formatDate(instant, 'en', { timeZone: 'Pacific/Auckland' })).toBe('Mon, 9 Nov')
    expect(formatDate(instant, 'en', { timeZone: 'UTC' })).toBe('Sun, 8 Nov')
  })

  it('rejects what is not a YYYY-MM-DD date', () => {
    expect(() => formatDate('9/11/2026', 'en')).toThrow(RangeError)
  })
})

describe('formatDateRange', () => {
  it('drops what both ends share', () => {
    expect(plain(formatDateRange('2026-11-09', '2026-11-14', 'zh-TW'))).toBe('11月9日 – 14日')
    expect(plain(formatDateRange('2026-11-09', '2026-11-14', 'en'))).toBe('9–14 Nov')
    expect(plain(formatDateRange('2026-11-09', '2026-12-02', 'zh-TW'))).toBe('11月9日 – 12月2日')
    expect(plain(formatDateRange('2026-11-09', '2026-12-02', 'en'))).toBe('9 Nov – 2 Dec')
  })

  it('shows years only across a new year, and one date for a one-day span', () => {
    expect(plain(formatDateRange('2026-12-28', '2027-01-03', 'zh-TW'))).toBe('2026年12月28日 – 2027年1月3日')
    expect(plain(formatDateRange('2026-12-28', '2027-01-03', 'en'))).toBe('28 Dec 2026 – 3 Jan 2027')
    expect(plain(formatDateRange('2026-11-09', '2026-11-09', 'en'))).toBe('9 Nov')
  })
})

describe('formatTime', () => {
  it('is 24-hour by default in both languages', () => {
    expect(plain(formatTime('07:05', 'zh-TW'))).toBe('07:05')
    expect(plain(formatTime('19:30', 'en'))).toBe('19:30')
  })

  it('can use a 12-hour clock', () => {
    expect(plain(formatTime('19:30', 'en', { hour12: true }))).toBe('7:30 pm')
    expect(plain(formatTime('19:30', 'zh-TW', { hour12: true }))).toBe('下午7:30')
  })

  it('shows an instant in its zone', () => {
    const instant = new Date('2026-11-09T01:30:00Z')
    expect(plain(formatTime(instant, 'en', { timeZone: 'Pacific/Auckland' }))).toBe('14:30')
  })

  it('rejects an impossible time', () => {
    expect(() => formatTime('24:00', 'en')).toThrow(RangeError)
  })
})

describe('formatDuration', () => {
  it('writes hours and minutes in words', () => {
    expect(formatDuration(200, 'zh-TW')).toBe('3 小時 20 分')
    expect(formatDuration(200, 'en')).toBe('3 h 20 min')
    expect(formatDuration(60, 'zh-TW')).toBe('1 小時')
    expect(formatDuration(60, 'en')).toBe('1 h')
    expect(formatDuration(45, 'zh-TW')).toBe('45 分')
    expect(formatDuration(45, 'en')).toBe('45 min')
    expect(formatDuration(0, 'en')).toBe('0 min')
  })

  it('rounds to whole minutes', () => {
    expect(formatDuration(89.6, 'en')).toBe('1 h 30 min')
  })
})

describe('formatDistance', () => {
  it('uses km with one decimal at most, and meters under 1 km', () => {
    expect(formatDistance(95230, 'en')).toBe('95.2 km')
    expect(formatDistance(95230, 'zh-TW')).toBe('95.2 km')
    expect(formatDistance(2180000, 'en')).toBe('2,180 km')
    expect(formatDistance(640, 'zh-TW')).toBe('640 m')
    expect(formatDistance(999.6, 'en')).toBe('1 km')
  })
})

describe('formatTzAbbrev', () => {
  it('gives what Intl knows for the zone at that instant', () => {
    const november = new Date('2026-11-09T00:00:00Z')
    expect(formatTzAbbrev('Pacific/Auckland', 'en', november)).toBe('NZDT')
    expect(formatTzAbbrev('Pacific/Auckland', 'zh-TW', november)).toBe('GMT+13')
    expect(formatTzAbbrev('America/Los_Angeles', 'en', november)).toBe('GMT-8')
    expect(formatTzAbbrev('Australia/Sydney', 'en', new Date('2026-07-01T00:00:00Z'))).toBe('AEST')
  })
})
