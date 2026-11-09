// The daily cleanup (e11-t06) against the real migrations on node:sqlite (fake-d1.ts, foreign keys
// on) and an in-memory R2 that lists two keys at a time, so the cursor is exercised.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCleanup, TRIP_PURGE_STATEMENTS, type CleanupSummary } from '../../worker/cleanup.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

function fakeR2() {
  const objects = new Map<string, string>()
  const deleteCalls: string[][] = []
  let failDelete = false
  const bucket = {
    async put(key: string, body: string) {
      objects.set(key, body)
    },
    async list({ prefix = '', cursor }: R2ListOptions = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      const page = keys.slice(start, start + 2)
      const truncated = start + 2 < keys.length
      return {
        objects: page.map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(start + 2) : undefined,
      }
    },
    async delete(keys: string | string[]) {
      if (failDelete) throw new Error('R2 is down')
      const list = Array.isArray(keys) ? keys : [keys]
      deleteCalls.push(list)
      for (const key of list) objects.delete(key)
    },
  }
  return {
    bucket: bucket as unknown as R2Bucket,
    objects,
    deleteCalls,
    setFailDelete: (value: boolean) => {
      failDelete = value
    },
  }
}

const NOW = Date.UTC(2026, 10, 9, 17, 0, 0)
const DAY = 24 * 60 * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

/** A trip with one of everything that hangs off it, deleted `deletedAgo` ms before NOW (or not) */
function seedTrip(
  sqlite: ReturnType<typeof createFakeD1>['sqlite'],
  id: string,
  deletedAgo: number | null,
) {
  const at = iso(NOW - 60 * DAY)
  const deletedAt = deletedAgo === null ? 'NULL' : `'${iso(NOW - deletedAgo)}'`
  const m = `${id}-m`
  sqlite.exec(`
    INSERT INTO trips (id, name, startDate, endDate, tz, ownerMemberId, createdAt, updatedAt, deletedAt)
      VALUES ('${id}', 'Trip ${id}', '2026-12-01', '2026-12-03', 'Pacific/Auckland', '${m}', '${at}', '${at}', ${deletedAt});
    INSERT INTO members (id, tripId, name, color, role, createdAt, updatedAt)
      VALUES ('${m}', '${id}', 'Gene', 'teal', 'owner', '${at}', '${at}');
    INSERT INTO memberTokens (tokenHash, tripId, memberId, createdAt) VALUES ('${id}-h', '${id}', '${m}', '${at}');
    INSERT INTO invites (id, tripId, tokenHash, createdByMemberId, createdAt) VALUES ('${id}-i', '${id}', '${id}-ih', '${m}', '${at}');
    INSERT INTO shares (id, tripId, tokenHash, createdByMemberId, createdAt) VALUES ('${id}-s', '${id}', '${id}-sh', '${m}', '${at}');
    INSERT INTO days (id, tripId, date, idx, createdAt, updatedAt) VALUES ('${id}-d', '${id}', '2026-12-01', 1, '${at}', '${at}');
    INSERT INTO places (id, tripId, nameLocal, lat, lng, createdAt, updatedAt) VALUES ('${id}-p', '${id}', 'P', 1, 2, '${at}', '${at}');
    INSERT INTO stops (id, tripId, dayId, "order", placeId, createdAt, updatedAt) VALUES ('${id}-st', '${id}', '${id}-d', 1, '${id}-p', '${at}', '${at}');
    INSERT INTO stops (id, tripId, dayId, "order", createdAt, updatedAt) VALUES ('${id}-st2', '${id}', '${id}-d', 2, '${at}', '${at}');
    INSERT INTO legOverrides (tripId, fromStopId, toStopId, mode, updatedAt) VALUES ('${id}', '${id}-st', '${id}-st2', 'walk', '${at}');
    INSERT INTO wishlistItems (id, tripId, category, name, placeId, recommenderMemberId, "order", createdAt, updatedAt)
      VALUES ('${id}-w', '${id}', 'eat', 'Pie', '${id}-p', '${m}', 1, '${at}', '${at}');
    INSERT INTO wishlistVotes (itemId, memberId, createdAt) VALUES ('${id}-w', '${m}', '${at}');
    INSERT INTO wishlistClaims (id, itemId, buyerMemberId, createdAt, updatedAt) VALUES ('${id}-wc', '${id}-w', '${m}', '${at}', '${at}');
    INSERT INTO lodgings (id, tripId, name, checkIn, checkOut, createdAt, updatedAt) VALUES ('${id}-l', '${id}', 'Inn', '2026-12-01', '2026-12-02', '${at}', '${at}');
    INSERT INTO bookings (id, tripId, type, title, payerMemberId, createdAt, updatedAt) VALUES ('${id}-b', '${id}', 'activity', 'Hike', '${m}', '${at}', '${at}');
    INSERT INTO expenses (id, tripId, payerMemberId, amountMinor, currency, fxRate, fxSource, baseMinor, date, category, splitMethod, createdByMemberId, createdAt, updatedAt)
      VALUES ('${id}-e', '${id}', '${m}', 100, 'AUD', 1, 'base', 100, '2026-12-01', 'food', 'self', '${m}', '${at}', '${at}');
    INSERT INTO expenseShares (expenseId, memberId, shareMinor) VALUES ('${id}-e', '${m}', 100);
    INSERT INTO poolContributions (id, tripId, memberId, amountMinor, currency, fxRate, fxSource, baseMinor, date, createdByMemberId, createdAt, updatedAt)
      VALUES ('${id}-pc', '${id}', '${m}', 100, 'AUD', 1, 'base', 100, '2026-12-01', '${m}', '${at}', '${at}');
    INSERT INTO expenseHistory (id, tripId, entity, entityId, memberId, at, action) VALUES ('${id}-eh', '${id}', 'expense', '${id}-e', '${m}', '${at}', 'create');
    INSERT INTO apiUsage (date, provider, tripId, count) VALUES ('2026-10-01', 'ors', '${id}', 3);
    INSERT INTO attachments (id, tripId, kind, r2Key, thumbKey, mime, bytes, uploaderMemberId, status, createdAt, updatedAt)
      VALUES ('${id}-a', '${id}', 'photo', 'production/trips/${id}/photo/${id}-a.webp', 'production/trips/${id}/photo/${id}-a.thumb', 'image/webp', 3, '${m}', 'ready', '${at}', '${at}');
  `)
  // settlements need two members
  sqlite.exec(`
    INSERT INTO members (id, tripId, name, color, role, createdAt, updatedAt)
      VALUES ('${m}2', '${id}', 'Kid', 'amber', 'editor', '${at}', '${at}');
    INSERT INTO settlements (id, tripId, fromMemberId, toMemberId, amountMinor, method, date, createdByMemberId, createdAt, updatedAt)
      VALUES ('${id}-se', '${id}', '${m}2', '${m}', 50, 'cash', '2026-12-02', '${m}', '${at}', '${at}');
  `)
}

function setup() {
  const d1 = createFakeD1()
  const r2 = fakeR2()
  const env = { DB: d1.db, MEDIA: r2.bucket, APP_ENV: 'production' } as unknown as Env
  return { ...d1, r2, env }
}

const count = (sqlite: ReturnType<typeof createFakeD1>['sqlite'], sql: string) =>
  Number(sqlite.prepare(sql).all()[0].n)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runCleanup (e11-t06)', () => {
  it('lists every table that has a tripId column in the trip purge', () => {
    const { sqlite } = setup()
    const tables = sqlite
      .prepare(
        `SELECT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) c
          WHERE m.type = 'table' AND c.name = 'tripId'`,
      )
      .all()
      .map((r) => String(r.name))
    expect(tables.length).toBeGreaterThan(10)
    for (const table of tables)
      expect(TRIP_PURGE_STATEMENTS.some((sql) => sql.startsWith(`DELETE FROM ${table} `))).toBe(
        true,
      )
  })

  it('purges trips deleted 30+ days ago with their R2 objects, and nothing else', async () => {
    const { sqlite, r2, env } = setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    seedTrip(sqlite, 'old', 31 * DAY)
    seedTrip(sqlite, 'recent', 29 * DAY)
    seedTrip(sqlite, 'live', null)
    for (const trip of ['old', 'recent', 'live']) {
      for (const n of [1, 2, 3])
        await r2.bucket.put(`production/trips/${trip}/photo/${n}.webp`, 'x', {})
      await r2.bucket.put(`production/trips/${trip}/document/doc.pdf`, 'x', {})
    }
    // another environment's copy of the same trip id is not ours to delete
    await r2.bucket.put('preview/trips/old/photo/1.webp', 'x', {})

    const summary = await runCleanup(env, NOW)
    expect(summary).toMatchObject({ trips: 1, tripObjects: 4, errors: [] })
    expect([...r2.objects.keys()].filter((k) => k.includes('/old/'))).toEqual([
      'preview/trips/old/photo/1.webp',
    ])
    expect([...r2.objects.keys()].filter((k) => k.includes('/recent/'))).toHaveLength(4)
    expect([...r2.objects.keys()].filter((k) => k.includes('/live/'))).toHaveLength(4)
    for (const table of ['trips', 'members', 'stops', 'expenses', 'attachments', 'settlements']) {
      expect(
        count(
          sqlite,
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'trips' ? 'id' : 'tripId'} = 'old'`,
        ),
      ).toBe(0)
      expect(
        count(
          sqlite,
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'trips' ? 'id' : 'tripId'} = 'recent'`,
        ),
      ).toBeGreaterThan(0)
    }
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM expenseShares WHERE expenseId = 'old-e'")).toBe(
      0,
    )
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM wishlistVotes WHERE itemId = 'old-w'")).toBe(0)
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM apiUsage WHERE tripId = 'old'")).toBe(0)
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM apiUsage WHERE tripId = 'live'")).toBe(1)
  })

  it('removes deleted attachments after 7 days and abandoned pending uploads after 15 minutes', async () => {
    const { sqlite, r2, env } = setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    seedTrip(sqlite, 'live', null)
    const add = (id: string, status: string, createdAgo: number, deletedAgo: number | null) => {
      const key = `production/trips/live/photo/${id}.webp`
      sqlite.exec(`INSERT INTO attachments (id, tripId, kind, r2Key, thumbKey, mime, bytes, uploaderMemberId, status, createdAt, updatedAt, deletedAt)
        VALUES ('${id}', 'live', 'photo', '${key}', '${key.replace('.webp', '.thumb')}', 'image/webp', 1, 'live-m', '${status}',
        '${iso(NOW - createdAgo)}', '${iso(NOW - createdAgo)}', ${deletedAgo === null ? 'NULL' : `'${iso(NOW - deletedAgo)}'`})`)
      return key
    }
    const keep = [
      add('kept', 'ready', 30 * DAY, null),
      add('deleted-6d', 'ready', 30 * DAY, 6 * DAY),
      add('pending-10m', 'pending', 10 * 60_000, null),
    ]
    const gone = [
      add('deleted-8d', 'ready', 30 * DAY, 8 * DAY),
      add('pending-20m', 'pending', 20 * 60_000, null),
    ]
    for (const key of [...keep, ...gone]) {
      await r2.bucket.put(key, 'x', {})
      await r2.bucket.put(key.replace('.webp', '.thumb'), 'x', {})
    }
    // the abandoned upload never got its thumbnail: deleting a missing key is fine
    r2.objects.delete(gone[1].replace('.webp', '.thumb'))

    const summary = await runCleanup(env, NOW)
    expect(summary).toMatchObject({ trips: 0, attachments: 1, pending: 1, errors: [] })
    const ids = sqlite
      .prepare("SELECT id FROM attachments WHERE tripId = 'live' ORDER BY id")
      .all()
      .map((r) => r.id)
    expect(ids).toEqual(['deleted-6d', 'kept', 'live-a', 'pending-10m'])
    for (const key of keep) expect(r2.objects.has(key)).toBe(true)
    for (const key of gone) {
      expect(r2.objects.has(key)).toBe(false)
      expect(r2.objects.has(key.replace('.webp', '.thumb'))).toBe(false)
    }
  })

  it('drops old rate-limit windows, throttle rows and expired cache rows', async () => {
    const { sqlite, env } = setup()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const minute = (ms: number) => Math.floor(ms / 60_000)
    sqlite.exec(`
      INSERT INTO rateLimits (key, bucket, count) VALUES ('old', ${minute(NOW - 3 * DAY)}, 1), ('new', ${minute(NOW - 60_000)}, 1);
      INSERT INTO providerThrottle (provider, lastAt) VALUES ('nominatim', ${NOW - 3 * DAY}), ('fx:AUD', ${NOW - DAY});
      INSERT INTO geoCache (key, provider, results, createdAt, expiresAt) VALUES
        ('a', 'photon', '[]', 'x', ${NOW - 1}), ('b', 'og', '{}', 'x', ${NOW + DAY});
    `)
    const summary = await runCleanup(env, NOW)
    expect(summary).toMatchObject({ rateLimits: 1, providerThrottle: 1, geoCache: 1, errors: [] })
    expect(
      sqlite
        .prepare('SELECT key FROM rateLimits')
        .all()
        .map((r) => r.key),
    ).toEqual(['new'])
    expect(
      sqlite
        .prepare('SELECT key FROM geoCache')
        .all()
        .map((r) => r.key),
    ).toEqual(['b'])
  })

  it('keeps the rows when R2 fails, logs it, and never throws', async () => {
    const { sqlite, r2, env } = setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedTrip(sqlite, 'old', 31 * DAY)
    await r2.bucket.put('production/trips/old/photo/1.webp', 'x', {})
    r2.setFailDelete(true)
    const summary: CleanupSummary = await runCleanup(env, NOW)
    expect(summary.trips).toBe(0)
    expect(summary.errors[0]).toMatch(/trip old: Error: R2 is down/)
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM trips WHERE id = 'old'")).toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"event":"cleanup_failed"'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"cleanup_done"'))

    // the next run, with R2 back, finishes the job
    r2.setFailDelete(false)
    expect((await runCleanup(env, NOW)).trips).toBe(1)
    expect(r2.objects.size).toBe(0)
  })
})
