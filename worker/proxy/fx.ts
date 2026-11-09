// Exchange rates (e7-t03): open.er-api.com (PRD Q4; free, no key, updated once a day, has TWD and
// AUD) cached in fxRates. A row reads "1 base = rate quote", dated by the provider's
// time_last_update (UTC). Filled three ways:
//   - the daily cron (worker/index.ts, after the backup): `refreshAllBases`, one call per distinct
//     base currency of the live trips plus AUD and TWD;
//   - on demand from the expense FX resolution (worker/trips/expenses.ts): `ensureRate`, at most
//     one call per base per hour, never throws;
//   - POST /api/trips/:id/fx/refresh (editor, 2 per minute per trip): `fxRefresh`.
// Every call is counted in apiUsage (provider 'fx'); a daily cap keeps a bug from hammering it.

import { CURRENCY_CODES } from '../../shared/money/currencies.ts'
import { authTrip } from '../auth.ts'
import type { Env } from '../env.ts'
import { ApiError, json } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { nowIsoFrom, proxyDeps } from './deps.ts'
import { claimSlot, enforceRateLimit, utcDate, withRetryAfter } from './limits.ts'

export const DEFAULT_FX_API_URL = 'https://open.er-api.com'
export const FX_SOURCE = 'open.er-api'
/** apiUsage provider name */
export const FX_PROVIDER = 'fx'
/** Calls to the provider across every trip per UTC day (the cron makes a handful) */
export const FX_DAILY_LIMIT = 100
/** On-demand fetches for one base currency are at least this far apart */
export const FX_ON_DEMAND_INTERVAL_MS = 60 * 60_000
/** POST /fx/refresh per trip per minute */
export const FX_REFRESH_PER_MINUTE = 2
/** How far back an fxRates row may serve a later date (same as worker/trips/expenses.ts) */
const LOOKBACK_DAYS = 7
/** Always refreshed by the cron: the default base and secondary display currencies */
const ALWAYS_BASES = ['AUD', 'TWD']
const TIMEOUT_MS = 8000

const known = new Set<string>(CURRENCY_CODES)
/** apiUsage tripId for calls not made for one trip (cron, on-demand fill) */
const ANY_TRIP = '*'

export interface FetchedRates {
  /** The provider's last update, as a UTC date (YYYY-MM-DD): the fxRates `date` */
  date: string
  base: string
  /** Rows written (known currencies other than the base) */
  count: number
}

interface ErApiBody {
  result?: string
  base_code?: string
  time_last_update_unix?: number
  time_last_update_utc?: string
  rates?: Record<string, unknown>
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Counts one provider call; false (nothing counted) once today's cap is used up */
async function reserveFxCall(db: D1Database, tripId: string): Promise<boolean> {
  const date = utcDate(proxyDeps.now())
  const total = await db
    .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM apiUsage WHERE date = ? AND provider = ?')
    .bind(date, FX_PROVIDER)
    .first<{ n: number }>()
  if (Number(total?.n ?? 0) >= FX_DAILY_LIMIT) return false
  await db
    .prepare(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (date, provider, tripId) DO UPDATE SET count = apiUsage.count + 1`,
    )
    .bind(date, FX_PROVIDER, tripId)
    .run()
  return true
}

/** The provider's update time as a UTC date; the unix field first, the RFC 2822 string second */
function updateDate(body: ErApiBody): string {
  if (typeof body.time_last_update_unix === 'number' && body.time_last_update_unix > 0)
    return utcDate(body.time_last_update_unix * 1000)
  const parsed = Date.parse(body.time_last_update_utc ?? '')
  if (Number.isFinite(parsed)) return utcDate(parsed)
  throw new Error('fx: no time_last_update')
}

/**
 * GET `${FX_API_URL}/v6/latest/${base}` and upsert one fxRates row per known quote currency.
 * Throws on any failure (HTTP, `result` not success, wrong base, quota); old rows stay as they were.
 */
export async function fetchRates(
  env: Pick<Env, 'DB' | 'FX_API_URL'>,
  base: string,
  tripId: string = ANY_TRIP,
): Promise<FetchedRates> {
  if (!known.has(base)) throw new Error(`fx: unknown base ${base}`)
  const db = env.DB
  if (!(await reserveFxCall(db, tripId))) throw new Error('fx: daily quota used up')
  const root = (env.FX_API_URL || DEFAULT_FX_API_URL).replace(/\/+$/, '')
  const response = await proxyDeps.fetch(`${root}/v6/latest/${base}`, {
    headers: { accept: 'application/json', 'user-agent': 'Tripfolio/1.0 (private trip planner)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`fx: HTTP ${response.status}`)
  const body = (await response.json()) as ErApiBody
  if (body?.result !== 'success') throw new Error(`fx: result ${String(body?.result)}`)
  if (body.base_code !== base) throw new Error(`fx: asked ${base}, got ${String(body.base_code)}`)
  const date = updateDate(body)
  const rows: [string, number][] = []
  for (const quote of CURRENCY_CODES) {
    const rate = body.rates?.[quote]
    if (quote !== base && typeof rate === 'number' && Number.isFinite(rate) && rate > 0)
      rows.push([quote, rate])
  }
  if (rows.length === 0) throw new Error('fx: no known rates')
  await db.batch(
    rows.map(([quote, rate]) =>
      db
        .prepare(
          `INSERT INTO fxRates (date, base, quote, rate, source) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (date, base, quote) DO UPDATE SET rate = excluded.rate, source = excluded.source`,
        )
        .bind(date, base, quote, rate, FX_SOURCE),
    ),
  )
  return { date, base, count: rows.length }
}

/**
 * The daily cron: one fetch per distinct base currency of the trips not deleted, plus AUD and
 * TWD. A failing base is logged and skipped. Returns what was stored.
 */
export async function refreshAllBases(
  env: Pick<Env, 'DB' | 'FX_API_URL'>,
): Promise<FetchedRates[]> {
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT baseCurrency AS base FROM trips WHERE deletedAt IS NULL',
  ).all<{ base: string }>()
  const bases = [...new Set([...ALWAYS_BASES, ...results.map((r) => String(r.base))])].filter((b) =>
    known.has(b),
  )
  const done: FetchedRates[] = []
  for (const base of bases) {
    try {
      done.push(await fetchRates(env, base))
    } catch (error) {
      console.warn(JSON.stringify({ event: 'fx_refresh_failed', base, error: String(error) }))
    }
  }
  console.log(
    JSON.stringify({ event: 'fx_refresh_done', at: nowIsoFrom(proxyDeps.now()), bases: done }),
  )
  return done
}

async function findRow(
  db: D1Database,
  { date, base, quote }: { date: string; base: string; quote: string },
): Promise<{ date: string; rate: number } | null> {
  const row = await db
    .prepare(
      `SELECT date, base, rate FROM fxRates
        WHERE date <= ? AND date >= ?
          AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
        ORDER BY date DESC, base = ? DESC LIMIT 1`,
    )
    .bind(date, addDays(date, -LOOKBACK_DAYS), base, quote, quote, base, base)
    .first<{ date: string; base: string; rate: number }>()
  if (!row) return null
  const rate = Number(row.rate)
  return { date: String(row.date), rate: String(row.base) === base ? rate : 1 / rate }
}

/**
 * On-demand fill for the expense FX resolution: the fxRates rate "1 base = rate quote" for `date`
 * (that day or up to 7 days earlier), fetching the latest rates for `base` when there is no row.
 * Only fetches when the latest rates could serve `date` (today minus 7 days … tomorrow) and at
 * most once per base per hour. Never throws: null when there is still no rate.
 */
export async function ensureRate(
  env: Pick<Env, 'DB' | 'FX_API_URL'>,
  want: { date: string; base: string; quote: string },
): Promise<{ date: string; rate: number } | null> {
  try {
    const found = await findRow(env.DB, want)
    if (found) return found
    if (!known.has(want.base) || !known.has(want.quote) || want.base === want.quote) return null
    const today = utcDate(proxyDeps.now())
    if (want.date < addDays(today, -LOOKBACK_DAYS) || want.date > addDays(today, 1)) return null
    if (!(await claimSlot(env.DB, `fx:${want.base}`, FX_ON_DEMAND_INTERVAL_MS, 0))) return null
    await fetchRates(env, want.base)
    return await findRow(env.DB, want)
  } catch (error) {
    console.warn(JSON.stringify({ event: 'fx_on_demand_failed', ...want, error: String(error) }))
    return null
  }
}

/** POST /api/trips/:id/fx/refresh (editor; 2 per minute per trip) → { date, count } */
export function fxRefresh(c: RouteContext): Promise<Response> {
  return withRetryAfter(async () => {
    const auth = await authTrip(c.request, c.env.DB, c.params.id, 'editor')
    await enforceRateLimit(c.env.DB, `fx:${auth.trip.id}`, FX_REFRESH_PER_MINUTE)
    let fetched: FetchedRates
    try {
      fetched = await fetchRates(c.env, auth.trip.baseCurrency, auth.trip.id)
    } catch (error) {
      console.warn(JSON.stringify({ event: 'fx_refresh_failed', error: String(error) }))
      throw new ApiError(502, 'provider_error', 'exchange rates are unavailable right now')
    }
    return json({ date: fetched.date, count: fetched.count })
  })
}
