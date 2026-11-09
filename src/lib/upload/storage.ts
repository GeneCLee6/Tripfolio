import type { Locale } from '../../../shared/i18n/t.ts'

// Storage numbers for the meter (e6-t05): how full a trip is against its 1.5 GB warning size.

export type UsageTone = 'ok' | 'warning' | 'danger'

/** Share of the warning size used, from 0 (may exceed 1) */
export const usageRatio = (bytes: number, warnAtBytes: number): number =>
  warnAtBytes > 0 ? Math.max(0, bytes) / warnAtBytes : 0

/** ok below 80 %, warning from 80 %, danger above the warning size */
export function usageTone(bytes: number, warnAtBytes: number): UsageTone {
  const ratio = usageRatio(bytes, warnAtBytes)
  if (ratio > 1) return 'danger'
  return ratio >= 0.8 ? 'warning' : 'ok'
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

/** 1536 MiB → "1.5 GB" (binary steps, the units people see on their phones), formatted with Intl */
export function formatBytes(bytes: number, locale: Locale): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit >= 2 && value < 10 ? 1 : 0,
  }).format(value)
}
