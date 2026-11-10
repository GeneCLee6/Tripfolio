import {
  USAGE_LIMITS,
  type AdminUsageResponse,
  type UsageWarning,
} from '../../../shared/api/admin.ts'
import type { UsageProvider } from '../../../shared/api/geo.ts'
import type { Locale, MessageKey } from '../../../shared/i18n/t.ts'
import { isApiError, request } from '../api.ts'
import { formatBytes } from '../upload/storage.ts'

// The usage page's client (e11-t05): GET /api/admin/usage?key=… and the small pure helpers that
// turn its numbers into lines. The key travels in the query string the page was opened with; it is
// never stored.

export const PROVIDERS: readonly UsageProvider[] = ['photon', 'nominatim', 'ors', 'fx', 'og']

export const adminApi = {
  usage: (key: string, signal?: AbortSignal) =>
    request<AdminUsageResponse>('GET', `/api/admin/usage?key=${encodeURIComponent(key)}`, {
      signal,
    }),
}

export type UsageErrorKind = 'disabled' | 'forbidden' | 'rateLimited' | 'other'

/** Which message a failed load shows */
export function usageErrorKind(error: unknown): UsageErrorKind {
  if (!isApiError(error)) return 'other'
  if (error.status === 503 && error.code === 'admin_disabled') return 'disabled'
  if (error.status === 403) return 'forbidden'
  if (error.status === 429) return 'rateLimited'
  return 'other'
}

export const formatCount = (n: number, locale: Locale) => new Intl.NumberFormat(locale).format(n)

/** 85.3 → "85.3%" in the locale */
export const formatPct = (pct: number, locale: Locale) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(pct / 100)

/** GB-s of Durable Object time (128 MB per active object) */
export const doGbSeconds = (seconds: number) => seconds * 0.125

export const providerLabelKey = (p: UsageProvider): MessageKey => `admin.usage.provider.${p}`

/** The label of a warning's metric */
export function metricLabelKey(metric: UsageWarning['metric']): MessageKey {
  if (metric.startsWith('external.'))
    return providerLabelKey(metric.slice('external.'.length) as UsageProvider)
  switch (metric) {
    case 'r2':
      return 'admin.usage.metric.r2'
    case 'd1Writes':
      return 'admin.usage.metric.d1Writes'
    case 'cf.requests':
      return 'admin.usage.cf.requests'
    case 'cf.d1Reads':
      return 'admin.usage.cf.d1Reads'
    case 'cf.d1Writes':
      return 'admin.usage.cf.d1Writes'
    default:
      return 'admin.usage.cf.do'
  }
}

export interface CfMeter {
  key: 'requests' | 'd1Reads' | 'd1Writes' | 'do'
  labelKey: MessageKey
  value: number
  limit: number
  /** Formatted "value / limit" parts */
  used: string
  max: string
}

/** The Cloudflare block as four meters against the free daily limits */
export function cfMeters(cf: NonNullable<AdminUsageResponse['cf']>, locale: Locale): CfMeter[] {
  const count = (key: CfMeter['key'], labelKey: MessageKey, value: number, limit: number) => ({
    key,
    labelKey,
    value,
    limit,
    used: formatCount(value, locale),
    max: formatCount(limit, locale),
  })
  const gbs = doGbSeconds(cf.doDuration)
  return [
    count('requests', 'admin.usage.cf.requests', cf.requests24h, USAGE_LIMITS.workerRequestsPerDay),
    count('d1Reads', 'admin.usage.cf.d1Reads', cf.d1Reads, USAGE_LIMITS.d1ReadsPerDay),
    count('d1Writes', 'admin.usage.cf.d1Writes', cf.d1Writes, USAGE_LIMITS.d1WritesPerDay),
    {
      ...count('do', 'admin.usage.cf.do', gbs, USAGE_LIMITS.doGbSecondsPerDay),
      used: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(gbs),
    },
  ]
}

export const bytesText = (bytes: number, locale: Locale) => formatBytes(bytes, locale)
