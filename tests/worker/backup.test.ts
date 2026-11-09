// The backup runs against the real migrations on node:sqlite (fake-d1.ts) and a stand-in for R2;
// what comes out is restored into an empty database, because only that shows it is a backup at all.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupKey, dumpDatabase, KEEP_MS, PAGE_ROWS, runBackup } from '../../worker/backup.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

type SqliteDatabase = ReturnType<typeof createFakeD1>['sqlite']

const sqliteModule = 'node:sqlite'
const { DatabaseSync } = (await import(/* @vite-ignore */ sqliteModule)) as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

interface Stored {
  key: string
  body: ArrayBuffer
  uploaded: Date
  customMetadata?: Record<string, string>
}

/** As much of R2's binding as the backup uses; lists two at a time to exercise the cursor */
function fakeR2() {
  const objects = new Map<string, Stored>()
  let clock = () => new Date()
  const bucket = {
    async put(key: string, body: ArrayBuffer, options?: R2PutOptions) {
      objects.set(key, {
        key,
        body,
        uploaded: clock(),
        customMetadata: options?.customMetadata as Record<string, string> | undefined,
      })
    },
    async get(key: string) {
      const object = objects.get(key)
      return object ? { ...object, arrayBuffer: async () => object.body } : null
    },
    async list({ prefix = '', cursor }: R2ListOptions = {}) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      const page = keys.slice(start, start + 2)
      const truncated = start + 2 < keys.length
      return {
        objects: page.map((key) => objects.get(key) as Stored),
        truncated,
        cursor: truncated ? String(start + 2) : undefined,
      }
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    },
  }
  return {
    bucket: bucket as unknown as R2Bucket,
    objects,
    setClock: (next: () => Date) => {
      clock = next
    },
  }
}

async function gunzip(body: ArrayBuffer): Promise<string> {
  const plain = new Response(body).body as ReadableStream<Uint8Array>
  return new Response(plain.pipeThrough(new DecompressionStream('gzip'))).text()
}

const NOW = Date.UTC(2026, 10, 9, 17, 0, 0)
const DAY = 24 * 60 * 60_000

function seeded(stops = 3) {
  const d1 = createFakeD1()
  d1.sqlite.exec(
    `CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT);
     INSERT INTO d1_migrations (name, applied_at) VALUES ('0001_init.sql', 'then'), ('0002_core.sql', 'then');
     CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);
     INSERT INTO _cf_KV VALUES ('internal', x'00');
     INSERT INTO trips (id, name, startDate, endDate, tz, ownerMemberId, createdAt, updatedAt)
       VALUES ('t1', 'O''Brien; DROP TABLE trips; --', '2026-12-01', '2026-12-05', 'Australia/Sydney', 'm1', 'x', 'x');
     INSERT INTO members (id, tripId, name, color, role, createdAt, updatedAt)
       VALUES ('m1', 't1', 'Tai' || char(0x7E41, 0x9AD4) || ' "q" ' || char(0x1F600) || char(10) || 'line', 'teal', 'owner', 'x', 'x');
     INSERT INTO days (id, tripId, date, idx, createdAt, updatedAt) VALUES ('d1', 't1', '2026-12-01', 0, 'x', 'x');`,
  )
  for (let i = 0; i < stops; i++) {
    d1.sqlite.exec(
      `INSERT INTO stops (id, tripId, dayId, "order", title, createdAt, updatedAt)
       VALUES ('s${i}', 't1', 'd1', ${i + 0.5}, 'stop ${i}', 'x', 'x')`,
    )
  }
  return d1
}

const userTables = (db: SqliteDatabase) =>
  db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name))

const contents = (db: SqliteDatabase) =>
  Object.fromEntries(
    userTables(db).map((name) => [
      name,
      db
        .prepare(`SELECT * FROM "${name}" ORDER BY 1`)
        .all()
        .map((row) => ({ ...row })),
    ]),
  )

const schemaOf = (db: SqliteDatabase) =>
  db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND substr(name, 1, 4) <> '_cf_' ORDER BY name`,
    )
    .all()
    .map((row) => ({ ...row }))

function envWith(db: D1Database, bucket: R2Bucket, APP_ENV?: string): Env {
  return { DB: db, BACKUPS: bucket, APP_VERSION: 'abc123', APP_ENV } as unknown as Env
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runBackup', () => {
  it('stores every table with its row count, gzipped, under the production prefix by default', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, sqlite } = seeded()
    const r2 = fakeR2()
    const key = await runBackup(envWith(db, r2.bucket), NOW)

    expect(key).toBe('backups/production/2026-11-09/d1.sql.gz')
    const stored = r2.objects.get(key) as Stored
    const counts = JSON.parse(String(stored.customMetadata?.tables)) as Record<string, number>
    expect(Object.keys(counts).sort()).toEqual(userTables(sqlite))
    expect(counts).toMatchObject({ trips: 1, members: 1, days: 1, stops: 3, meta: 1 })
    expect(counts).toHaveProperty('d1_migrations', 2)
    expect(counts).not.toHaveProperty('_cf_KV')
    expect(stored.customMetadata).toMatchObject({
      env: 'production',
      appVersion: 'abc123',
      rows: '9',
    })

    // Restored into an empty database, it is the same database
    const sql = await gunzip(stored.body)
    expect(sql).not.toContain('_cf_KV')
    const restored = new DatabaseSync(':memory:')
    restored.exec(sql)
    expect(contents(restored)).toEqual(contents(sqlite))
    expect(schemaOf(restored)).toEqual(schemaOf(sqlite))
  })

  it('pages through large tables', async () => {
    const { db, sqlite } = seeded(PAGE_ROWS * 2 + 7)
    const dump = await dumpDatabase(db)
    expect(dump.tables.stops).toBe(PAGE_ROWS * 2 + 7)
    const restored = new DatabaseSync(':memory:')
    restored.exec(dump.sql)
    expect(contents(restored).stops).toEqual(contents(sqlite).stops)
  })

  it('writes under APP_ENV, so a preview never touches the production prefix', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const r2 = fakeR2()
    const key = await runBackup(envWith(seeded().db, r2.bucket, 'preview'), NOW)
    expect(key).toBe('backups/preview/2026-11-09/d1.sql.gz')
    expect([...r2.objects.keys()].every((k) => k.startsWith('backups/preview/'))).toBe(true)
    expect(backupKey({}, NOW)).toBe('backups/production/2026-11-09/d1.sql.gz')
  })

  it('deletes its own backups older than 30 days and keeps the rest', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r2 = fakeR2()
    const put = async (key: string, ms: number) => {
      r2.setClock(() => new Date(ms))
      await r2.bucket.put(key, new ArrayBuffer(1))
    }
    await put('backups/production/2026-09-01/d1.sql.gz', NOW - 69 * DAY)
    await put('backups/production/2026-10-09/d1.sql.gz', NOW - KEEP_MS - 1)
    await put('backups/production/2026-10-11/d1.sql.gz', NOW - 29 * DAY)
    await put('backups/production/2026-11-08/d1.sql.gz', NOW - DAY)
    await put('backups/preview/2026-09-01/d1.sql.gz', NOW - 69 * DAY)
    r2.setClock(() => new Date(NOW))

    await runBackup(envWith(seeded().db, r2.bucket), NOW)

    expect([...r2.objects.keys()].sort()).toEqual([
      'backups/preview/2026-09-01/d1.sql.gz',
      'backups/production/2026-10-11/d1.sql.gz',
      'backups/production/2026-11-08/d1.sql.gz',
      'backups/production/2026-11-09/d1.sql.gz',
    ])
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      event: 'backup_done',
      dropped: 2,
    })
  })

  it('logs and rethrows a failure, and keeps the old backups', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r2 = fakeR2()
    r2.setClock(() => new Date(NOW - 60 * DAY))
    await r2.bucket.put('backups/production/2026-09-10/d1.sql.gz', new ArrayBuffer(1))
    const broken = {
      prepare: () => {
        throw new Error('D1 is down')
      },
    } as unknown as D1Database

    await expect(runBackup(envWith(broken, r2.bucket), NOW)).rejects.toThrow('D1 is down')
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: 'backup_failed' })
    expect(r2.objects.size).toBe(1)
  })
})
