import type { UsageProvider } from './geo.ts'

// GET /api/admin/usage?key=<ADMIN_KEY> (e11-t05, AC-11.5): the site-wide usage page. Only the
// operator holding the ADMIN_KEY secret can read it (DEPLOY.md §14); no member token involved.

const GB = 1024 ** 3

/** Free-tier limits and soft daily budgets the page measures against */
export const USAGE_LIMITS = {
  /** R2 free storage */
  r2Bytes: 10 * GB,
  /** D1 free writes (rows written) per day */
  d1WritesPerDay: 100_000,
  /** D1 free reads (rows read) per day */
  d1ReadsPerDay: 5_000_000,
  /** Workers free requests per day */
  workerRequestsPerDay: 100_000,
  /** Durable Objects free duration per day, GB-s (128 MB per active object) */
  doGbSecondsPerDay: 13_000,
  /**
   * External calls per UTC day. ors and fx are enforced by the proxies (GEO_LIMITS.orsPerDay,
   * worker/proxy/fx.ts); photon, nominatim and og have no hard quota (fair use), so these are
   * soft budgets that only drive the warning
   */
  external: { photon: 5_000, nominatim: 2_000, ors: 2_000, fx: 100, og: 1_000 },
} as const

/** A share at or above this is a warning */
export const USAGE_WARN_RATIO = 0.8

export interface UsageMeter {
  /** Used so far (today for daily metrics) */
  today: number
  limit: number
  /** today / limit × 100, one decimal */
  pct: number
}

export interface UsageTripBytes {
  tripId: string
  name: string
  bytes: number
}

export interface UsageCf {
  /** Worker requests in the last 24 hours */
  requests24h: number
  /** D1 rows read / written in the last 24 hours */
  d1Reads: number
  d1Writes: number
  /** Durable Object active time in the last 24 hours, seconds */
  doDuration: number
}

export type UsageMetric =
  | `external.${UsageProvider}`
  | 'r2'
  | 'd1Writes'
  | 'cf.requests'
  | 'cf.d1Reads'
  | 'cf.d1Writes'
  | 'cf.do'

export interface UsageWarning {
  metric: UsageMetric
  pct: number
  /** True when over 100 % */
  over: boolean
}

export interface AdminUsageResponse {
  /** UTC day of the daily counts (YYYY-MM-DD) */
  date: string
  external: Record<UsageProvider, UsageMeter>
  r2: {
    /** Ready, not purged attachments (thumbnails included), from D1 */
    bytes: number
    limitBytes: number
    pct: number
    /** The five largest trips */
    byTrip: UsageTripBytes[]
    /** The per-trip warning size (E6, 1.5 GB) */
    tripWarnBytes: number
  }
  d1: {
    /** Rows per table */
    rows: Record<string, number>
    /**
     * A lower bound for today's writes: rate-limit hits still in the table, apiUsage counts, and
     * expense history rows created today
     */
    estimatedWritesToday: number
    limitWrites: number
    pct: number
  }
  trips: {
    active: number
    archived: number
    /** Soft-deleted, still restorable */
    deleted: number
    /** Soft-deleted for 30+ days, waiting for the daily cleanup */
    pendingPurge: number
  }
  /** Cloudflare GraphQL Analytics; null when CF_ANALYTICS_TOKEN or the account id is not set */
  cf: UsageCf | null
  cfStatus: 'unconfigured' | 'ok' | 'error'
  warnings: UsageWarning[]
}
