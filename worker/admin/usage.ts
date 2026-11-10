// GET /api/admin/usage?key=<ADMIN_KEY> (e11-t05, AC-11.5): the operator's usage page.
//
// Site-wide, so it is not tied to a trip or a member token: the caller must present the ADMIN_KEY
// secret (503 admin_disabled while it is unset, 403 on a wrong key; 10 requests per minute per IP).
// What it adds up, all from D1 except the optional Cloudflare block:
//   - external calls today per provider (apiUsage) against the enforced quotas / soft budgets;
//   - R2 storage from attachments.bytes + thumbBytes (every row still in the bucket, soft-deleted
//     included until the cleanup purges it) against the free 10 GB, plus the five largest trips;
//   - D1 rows per table and a lower-bound estimate of today's writes;
//   - trips by lifecycle state;
//   - Workers requests, D1 rows read/written and Durable Object time over the last 24 hours from the
//     Cloudflare GraphQL Analytics API, only when CF_ANALYTICS_TOKEN and the account id are set.
// Anything at or above 80 % lands in `warnings` and is logged once per call (`usage_warning`).
// Counting rows scans the tables (D1 bills rows read), which is one reason for the rate limit.

import {
  USAGE_LIMITS,
  USAGE_WARN_RATIO,
  type AdminUsageResponse,
  type UsageCf,
  type UsageMeter,
  type UsageMetric,
  type UsageWarning,
} from '../../shared/api/admin.ts'
import { GEO_LIMITS, type UsageProvider } from '../../shared/api/geo.ts'
import { attachmentLimits } from '../../shared/schema/attachment.ts'
import { timingSafeEqual } from '../auth.ts'
import { TRIP_RETENTION_MS } from '../cleanup.ts'
import type { Env } from '../env.ts'
import { ApiError, json } from '../http.ts'
import { proxyDeps } from '../proxy/deps.ts'
import { FX_DAILY_LIMIT } from '../proxy/fx.ts'
import { utcDate } from '../proxy/limits.ts'
import type { RouteContext } from '../router.ts'
import { clientIp, enforceLimit, MINUTE } from '../security/ratelimit.ts'

export const PROVIDERS: readonly UsageProvider[] = ['photon', 'nominatim', 'ors', 'fx', 'og']

/** Daily limits per provider: the proxies' enforced quotas where they exist, else soft budgets */
export const EXTERNAL_LIMITS: Record<UsageProvider, number> = {
  ...USAGE_LIMITS.external,
  ors: GEO_LIMITS.orsPerDay,
  fx: FX_DAILY_LIMIT,
}

/** Every table counted on the page (a fixed list: the names go into SQL) */
export const USAGE_TABLES = [
  'trips',
  'members',
  'memberTokens',
  'invites',
  'shares',
  'days',
  'places',
  'stops',
  'legOverrides',
  'wishlistItems',
  'wishlistVotes',
  'wishlistClaims',
  'attachments',
  'lodgings',
  'bookings',
  'expenses',
  'expenseShares',
  'poolContributions',
  'settlements',
  'expenseHistory',
  'fxRates',
  'geoCache',
  'routeCache',
  'apiUsage',
  'rateLimits',
  'providerThrottle',
] as const

export const ADMIN_RATE_LIMIT = { limit: 10, windowS: MINUTE }

const LOOPBACK = new Set(['127.0.0.1', '::1'])

/** used / limit as a percentage with one decimal; 0 for a zero limit */
export function pctOf(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.round((Math.max(0, used) / limit) * 1000) / 10
}

export const meter = (today: number, limit: number): UsageMeter => ({
  today,
  limit,
  pct: pctOf(today, limit),
})

/** The metrics at or above 80 %, largest first */
export function collectWarnings(metrics: [UsageMetric, number][]): UsageWarning[] {
  return metrics
    .filter(([, pct]) => pct >= USAGE_WARN_RATIO * 100)
    .map(([metric, pct]) => ({ metric, pct, over: pct > 100 }))
    .sort((a, b) => b.pct - a.pct)
}

/** The ADMIN_KEY gate: 503 while the secret is unset, 403 on a missing or wrong key */
export function checkAdminKey(env: Env, url: URL): void {
  const secret = env.ADMIN_KEY
  if (!secret) throw new ApiError(503, 'admin_disabled', 'ADMIN_KEY is not set')
  const given = url.searchParams.get('key') ?? ''
  if (!given || !timingSafeEqual(given, secret)) throw new ApiError(403, 'forbidden', 'wrong key')
}

type Row = Record<string, unknown>
const num = (v: unknown) => Number(v ?? 0) || 0

/** The site-wide numbers from D1 (`now` in epoch ms) */
export async function collectUsage(
  db: D1Database,
  now: number,
): Promise<Omit<AdminUsageResponse, 'cf' | 'cfStatus' | 'warnings'>> {
  const date = utcDate(now)
  const dayStartMs = Date.parse(`${date}T00:00:00Z`)
  const dayStartMin = Math.floor(dayStartMs / 60_000)
  const purgeBefore = new Date(now - TRIP_RETENTION_MS).toISOString()
  const results = await db.batch<Row>([
    db
      .prepare('SELECT provider, SUM(count) AS n FROM apiUsage WHERE date = ? GROUP BY provider')
      .bind(date),
    db.prepare('SELECT COALESCE(SUM(bytes + COALESCE(thumbBytes, 0)), 0) AS n FROM attachments'),
    db.prepare(
      `SELECT a.tripId AS tripId, COALESCE(t.name, '') AS name,
              SUM(a.bytes + COALESCE(a.thumbBytes, 0)) AS bytes
         FROM attachments a LEFT JOIN trips t ON t.id = a.tripId
        GROUP BY a.tripId ORDER BY bytes DESC, a.tripId LIMIT 5`,
    ),
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN deletedAt IS NULL AND archivedAt IS NULL THEN 1 END), 0) AS active,
           COALESCE(SUM(CASE WHEN deletedAt IS NULL AND archivedAt IS NOT NULL THEN 1 END), 0) AS archived,
           COALESCE(SUM(CASE WHEN deletedAt >= ? THEN 1 END), 0) AS deleted,
           COALESCE(SUM(CASE WHEN deletedAt < ? THEN 1 END), 0) AS pendingPurge
         FROM trips`,
      )
      .bind(purgeBefore, purgeBefore),
    db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(count), 0) FROM rateLimits WHERE bucket >= ?) +
           (SELECT COALESCE(SUM(count), 0) FROM apiUsage WHERE date = ?) +
           (SELECT COUNT(*) FROM expenseHistory WHERE at >= ?) AS n`,
      )
      .bind(dayStartMin, date, new Date(dayStartMs).toISOString()),
    db.prepare(
      `SELECT ${USAGE_TABLES.map((name) => `(SELECT COUNT(*) FROM ${name}) AS ${name}`).join(', ')}`,
    ),
  ])
  const [usageRows, r2Row, topRows, tripRow, writesRow, countRow] = results.map(
    (r) => r?.results ?? [],
  )

  const counts = Object.fromEntries(PROVIDERS.map((p) => [p, 0])) as Record<UsageProvider, number>
  for (const r of usageRows ?? []) {
    const provider = String(r.provider)
    if ((PROVIDERS as string[]).includes(provider)) counts[provider as UsageProvider] = num(r.n)
  }
  const external = Object.fromEntries(
    PROVIDERS.map((p) => [p, meter(counts[p], EXTERNAL_LIMITS[p])]),
  ) as Record<UsageProvider, UsageMeter>

  const r2Bytes = num(r2Row?.[0]?.n)
  const trips = tripRow?.[0] ?? {}
  const writes = num(writesRow?.[0]?.n)
  const counted = countRow?.[0] ?? {}
  return {
    date,
    external,
    r2: {
      bytes: r2Bytes,
      limitBytes: USAGE_LIMITS.r2Bytes,
      pct: pctOf(r2Bytes, USAGE_LIMITS.r2Bytes),
      byTrip: (topRows ?? []).map((r) => ({
        tripId: String(r.tripId),
        name: String(r.name ?? ''),
        bytes: num(r.bytes),
      })),
      tripWarnBytes: attachmentLimits.warnTripBytes,
    },
    d1: {
      rows: Object.fromEntries(USAGE_TABLES.map((name) => [name, num(counted[name])])),
      estimatedWritesToday: writes,
      limitWrites: USAGE_LIMITS.d1WritesPerDay,
      pct: pctOf(writes, USAGE_LIMITS.d1WritesPerDay),
    },
    trips: {
      active: num(trips.active),
      archived: num(trips.archived),
      deleted: num(trips.deleted),
      pendingPurge: num(trips.pendingPurge),
    },
  }
}

export const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

/** The Analytics query (DEPLOY.md §14 shows the same text) */
export const CF_USAGE_QUERY = `query TripfolioUsage($account: String!, $since: Time!, $until: Time!, $sinceDate: Date!, $untilDate: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
        sum { requests }
      }
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $sinceDate, date_leq: $untilDate }) {
        sum { rowsRead rowsWritten }
      }
      durableObjectsPeriodicGroups(limit: 10000, filter: { datetimeMinute_geq: $since, datetimeMinute_leq: $until }) {
        sum { activeTime }
      }
    }
  }
}`

interface CfSumRows {
  sum?: Record<string, number | null>
}

const sumOf = (rows: CfSumRows[] | undefined, field: string) =>
  (rows ?? []).reduce((total, r) => total + num(r.sum?.[field]), 0)

/** The last 24 hours from Cloudflare; throws on a transport or GraphQL error */
export async function fetchCfUsage(token: string, account: string, now: number): Promise<UsageCf> {
  const since = new Date(now - 24 * 3600_000)
  const response = await proxyDeps.fetch(CF_GRAPHQL_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: CF_USAGE_QUERY,
      variables: {
        account,
        since: since.toISOString(),
        until: new Date(now).toISOString(),
        // D1 analytics are per day: yesterday and today (UTC) cover the window
        sinceDate: utcDate(since.getTime()),
        untilDate: utcDate(now),
      },
    }),
  })
  if (!response.ok) throw new Error(`cf analytics HTTP ${response.status}`)
  const body = (await response.json()) as {
    data?: {
      viewer?: {
        accounts?: {
          workersInvocationsAdaptive?: CfSumRows[]
          d1AnalyticsAdaptiveGroups?: CfSumRows[]
          durableObjectsPeriodicGroups?: CfSumRows[]
        }[]
      }
    } | null
    errors?: { message?: string }[] | null
  }
  if (body.errors?.length) throw new Error(`cf analytics: ${body.errors[0]?.message ?? 'error'}`)
  const account0 = body.data?.viewer?.accounts?.[0]
  if (!account0) throw new Error('cf analytics: account not found')
  return {
    requests24h: sumOf(account0.workersInvocationsAdaptive, 'requests'),
    d1Reads: sumOf(account0.d1AnalyticsAdaptiveGroups, 'rowsRead'),
    d1Writes: sumOf(account0.d1AnalyticsAdaptiveGroups, 'rowsWritten'),
    // activeTime is in microseconds
    doDuration: Math.round(sumOf(account0.durableObjectsPeriodicGroups, 'activeTime') / 1e6),
  }
}

/** GB-s for a Durable Object duration in seconds (billed at 128 MB per active object) */
export const doGbSeconds = (seconds: number) => seconds * 0.125

export function usageWarnings(
  body: Omit<AdminUsageResponse, 'warnings' | 'cfStatus'>,
): UsageWarning[] {
  const metrics: [UsageMetric, number][] = [
    ...PROVIDERS.map((p): [UsageMetric, number] => [`external.${p}`, body.external[p].pct]),
    ['r2', body.r2.pct],
    ['d1Writes', body.d1.pct],
  ]
  if (body.cf) {
    metrics.push(
      ['cf.requests', pctOf(body.cf.requests24h, USAGE_LIMITS.workerRequestsPerDay)],
      ['cf.d1Reads', pctOf(body.cf.d1Reads, USAGE_LIMITS.d1ReadsPerDay)],
      ['cf.d1Writes', pctOf(body.cf.d1Writes, USAGE_LIMITS.d1WritesPerDay)],
      ['cf.do', pctOf(doGbSeconds(body.cf.doDuration), USAGE_LIMITS.doGbSecondsPerDay)],
    )
  }
  return collectWarnings(metrics)
}

export async function adminUsage(c: RouteContext): Promise<Response> {
  if (!c.env.ADMIN_KEY) throw new ApiError(503, 'admin_disabled', 'ADMIN_KEY is not set')
  // Counted before the key check, so wrong guesses are limited too. Loopback only happens locally
  // (see worker/security/ratelimit.ts)
  const ip = clientIp(c.request)
  if (!LOOPBACK.has(ip)) await enforceLimit(c.env.DB, `ip:admin-usage:${ip}`, ADMIN_RATE_LIMIT)
  checkAdminKey(c.env, c.url)
  const now = proxyDeps.now()
  const base = await collectUsage(c.env.DB, now)

  const token = c.env.CF_ANALYTICS_TOKEN
  const account = c.env.CF_ACCOUNT_ID || c.env.CLOUDFLARE_ACCOUNT_ID
  let cf: UsageCf | null = null
  let cfStatus: AdminUsageResponse['cfStatus'] = 'unconfigured'
  if (token && account) {
    try {
      cf = await fetchCfUsage(token, account, now)
      cfStatus = 'ok'
    } catch (error) {
      cfStatus = 'error'
      console.error(JSON.stringify({ event: 'usage_cf_failed', error: String(error) }))
    }
  }
  const warnings = usageWarnings({ ...base, cf })
  if (warnings.length)
    console.warn(JSON.stringify({ event: 'usage_warning', date: base.date, warnings }))
  const body: AdminUsageResponse = { ...base, cf, cfStatus, warnings }
  return json(body)
}
