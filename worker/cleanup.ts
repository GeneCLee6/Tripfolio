import type { Env } from './env.ts'
import { mediaPrefix } from './media.ts'

// The daily cleanup (e11-t06), run by the cron after the backup and the exchange rates
// (worker/index.ts). It removes what users already deleted, once the undo window has passed, and
// the bookkeeping the proxies leave behind:
//   (a) trips soft-deleted 30+ days ago: every R2 object under <APP_ENV>/trips/<tripId>/, then
//       every row of the trip (children first: D1 enforces foreign keys)
//   (b) attachments soft-deleted 7+ days ago: their R2 objects, then the rows
//   (c) uploads still 'pending' 15+ minutes after /sign (abandoned): any object, then the row
//   (d) rateLimits / providerThrottle rows older than 2 days
//   (e) expired geoCache rows (place search and link previews)
// R2 goes first in each step: when it fails the rows stay, so the next run tries again (a row
// without its object is harmless; an object without a row could never be found again). Each step
// catches its own error, so one failure does not stop the others; the run never throws.

export const TRIP_RETENTION_MS = 30 * 24 * 60 * 60_000
export const ATTACHMENT_RETENTION_MS = 7 * 24 * 60 * 60_000
/** Same as UPLOAD_TTL_MS in media.ts: past it /content and /complete refuse the upload */
export const PENDING_RETENTION_MS = 15 * 60_000
export const BOOKKEEPING_RETENTION_MS = 2 * 24 * 60 * 60_000
/** At most this many trips / attachments per run; the rest wait for the next day */
export const MAX_TRIPS_PER_RUN = 20
export const MAX_ATTACHMENTS_PER_RUN = 500
/** R2 delete() takes at most 1000 keys */
const R2_DELETE_BATCH = 1000

/**
 * Rows of a trip in the order they can be deleted (children before parents). Every table with a
 * tripId column must be listed (tests/worker/cleanup.test.ts checks it), plus the tables that hang
 * off them by another id (expenseShares, wishlistVotes, wishlistClaims).
 */
export const TRIP_PURGE_STATEMENTS: readonly string[] = [
  'DELETE FROM expenseShares WHERE expenseId IN (SELECT id FROM expenses WHERE tripId = ?1)',
  'DELETE FROM expenseHistory WHERE tripId = ?1',
  'DELETE FROM settlements WHERE tripId = ?1',
  'DELETE FROM poolContributions WHERE tripId = ?1',
  'DELETE FROM expenses WHERE tripId = ?1',
  'DELETE FROM wishlistVotes WHERE itemId IN (SELECT id FROM wishlistItems WHERE tripId = ?1)',
  'DELETE FROM wishlistClaims WHERE itemId IN (SELECT id FROM wishlistItems WHERE tripId = ?1)',
  'DELETE FROM wishlistItems WHERE tripId = ?1',
  'DELETE FROM legOverrides WHERE tripId = ?1',
  'DELETE FROM stops WHERE tripId = ?1',
  'DELETE FROM attachments WHERE tripId = ?1',
  'DELETE FROM bookings WHERE tripId = ?1',
  'DELETE FROM lodgings WHERE tripId = ?1',
  'DELETE FROM days WHERE tripId = ?1',
  'DELETE FROM places WHERE tripId = ?1',
  'DELETE FROM shares WHERE tripId = ?1',
  'DELETE FROM invites WHERE tripId = ?1',
  'DELETE FROM memberTokens WHERE tripId = ?1',
  'DELETE FROM checklistItems WHERE tripId = ?1',
  'DELETE FROM checklists WHERE tripId = ?1',
  'DELETE FROM budgets WHERE tripId = ?1',
  'DELETE FROM notes WHERE tripId = ?1',
  'DELETE FROM members WHERE tripId = ?1',
  'DELETE FROM apiUsage WHERE tripId = ?1',
  'DELETE FROM trips WHERE id = ?1',
]

export interface CleanupSummary {
  trips: number
  tripObjects: number
  attachments: number
  attachmentObjects: number
  pending: number
  rateLimits: number
  providerThrottle: number
  geoCache: number
  errors: string[]
}

type Row = Record<string, unknown>

async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<number> {
  const unique = [...new Set(keys)]
  for (let i = 0; i < unique.length; i += R2_DELETE_BATCH)
    await bucket.delete(unique.slice(i, i + R2_DELETE_BATCH))
  return unique.length
}

/** Deletes every object under `prefix` (paged listing); returns how many */
export async function purgePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  // All keys first, then the deletes: deleting between pages could shift what a cursor points at
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    for (const object of page.objects) keys.push(object.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys.length ? deleteKeys(bucket, keys) : 0
}

const attachmentKeys = (rows: Row[]) =>
  rows.flatMap((r) => [String(r.r2Key), ...(r.thumbKey ? [String(r.thumbKey)] : [])])

/** (a) Trips deleted before `cutoff`: R2 prefix, then every row */
async function purgeTrips(env: Env, cutoff: string, summary: CleanupSummary): Promise<void> {
  const db = env.DB
  const { results } = await db
    .prepare(
      'SELECT id FROM trips WHERE deletedAt IS NOT NULL AND deletedAt < ? ORDER BY deletedAt LIMIT ?',
    )
    .bind(cutoff, MAX_TRIPS_PER_RUN)
    .all<Row>()
  for (const row of results) {
    const tripId = String(row.id)
    try {
      // The prefix covers this environment's keys; the rows' own keys cover anything stored
      // under another prefix (an APP_ENV that changed)
      let objects = await purgePrefix(env.MEDIA, mediaPrefix(env, tripId))
      const { results: rows } = await db
        .prepare('SELECT r2Key, thumbKey FROM attachments WHERE tripId = ?')
        .bind(tripId)
        .all<Row>()
      const leftover = attachmentKeys(rows).filter(
        (key) => !key.startsWith(mediaPrefix(env, tripId)),
      )
      if (leftover.length) objects += await deleteKeys(env.MEDIA, leftover)
      await db.batch(TRIP_PURGE_STATEMENTS.map((sql) => db.prepare(sql).bind(tripId)))
      summary.trips += 1
      summary.tripObjects += objects
    } catch (error) {
      summary.errors.push(`trip ${tripId}: ${String(error)}`)
    }
  }
}

/** (b) and (c): attachment rows matching `where`, objects first */
async function purgeAttachments(
  env: Env,
  where: string,
  value: string,
): Promise<{ rows: number; objects: number }> {
  const db = env.DB
  const { results } = await db
    .prepare(`SELECT id, r2Key, thumbKey FROM attachments WHERE ${where} LIMIT ?`)
    .bind(value, MAX_ATTACHMENTS_PER_RUN)
    .all<Row>()
  if (results.length === 0) return { rows: 0, objects: 0 }
  // R2 delete() of a key that does not exist is not an error: pending uploads may have none
  const objects = await deleteKeys(env.MEDIA, attachmentKeys(results))
  await db.batch(
    results.map((r) => db.prepare('DELETE FROM attachments WHERE id = ?').bind(String(r.id))),
  )
  return { rows: results.length, objects }
}

/** Runs one step, recording its error instead of throwing */
async function step(summary: CleanupSummary, name: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    summary.errors.push(`${name}: ${String(error)}`)
  }
}

/** The daily cleanup; logs `{ event: 'cleanup_done', ... }` and returns the same summary */
export async function runCleanup(env: Env, now: number = Date.now()): Promise<CleanupSummary> {
  const db = env.DB
  const summary: CleanupSummary = {
    trips: 0,
    tripObjects: 0,
    attachments: 0,
    attachmentObjects: 0,
    pending: 0,
    rateLimits: 0,
    providerThrottle: 0,
    geoCache: 0,
    errors: [],
  }
  const iso = (ms: number) => new Date(ms).toISOString()

  await step(summary, 'trips', () => purgeTrips(env, iso(now - TRIP_RETENTION_MS), summary))
  await step(summary, 'attachments', async () => {
    const done = await purgeAttachments(
      env,
      'deletedAt IS NOT NULL AND deletedAt < ?',
      iso(now - ATTACHMENT_RETENTION_MS),
    )
    summary.attachments += done.rows
    summary.attachmentObjects += done.objects
  })
  await step(summary, 'pending', async () => {
    const done = await purgeAttachments(
      env,
      "status = 'pending' AND createdAt < ?",
      iso(now - PENDING_RETENTION_MS),
    )
    summary.pending += done.rows
    summary.attachmentObjects += done.objects
  })
  await step(summary, 'bookkeeping', async () => {
    const before = now - BOOKKEEPING_RETENTION_MS
    const [rateLimits, throttle, geoCache] = await db.batch([
      // rateLimits.bucket is the minute number (epoch ms / 60 000)
      db.prepare('DELETE FROM rateLimits WHERE bucket < ?').bind(Math.floor(before / 60_000)),
      db.prepare('DELETE FROM providerThrottle WHERE lastAt < ?').bind(before),
      db.prepare('DELETE FROM geoCache WHERE expiresAt <= ?').bind(now),
    ])
    summary.rateLimits = Number(rateLimits.meta?.changes ?? 0)
    summary.providerThrottle = Number(throttle.meta?.changes ?? 0)
    summary.geoCache = Number(geoCache.meta?.changes ?? 0)
  })

  const { errors, ...counts } = summary
  if (errors.length)
    console.error(
      JSON.stringify({ event: 'cleanup_failed', ...counts, errors: errors.slice(0, 10) }),
    )
  console.log(JSON.stringify({ event: 'cleanup_done', ...counts, errors: errors.length }))
  return summary
}
