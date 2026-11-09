import type { Env } from './env.ts'

// The daily D1 backup (e11-t03, DEPLOY.md §10), after TKU Arcade's worker/backup.ts. The whole
// database goes to R2 as one gzipped SQL file that rebuilds it in an empty database
// (`wrangler d1 execute --file`), under a prefix per environment, since previews share the buckets
// with production (DEPLOY.md §2).

/** Rows read at a time */
export const PAGE_ROWS = 1000
/** Backups older than this are deleted, once today's is safely stored */
export const KEEP_MS = 30 * 24 * 60 * 60_000

const quoteName = (name: string) => `"${name.replace(/"/g, '""')}"`

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'string') {
    // A NUL inside a string literal would end it for SQLite
    return `'${value.replace(/'/g, "''").replace(/\0/g, "'||char(0)||'")}'`
  }
  // D1 gives a BLOB as an array of bytes
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : Array.isArray(value)
          ? (value as number[])
          : null
  if (!bytes) throw new Error(`Cannot back up a value of type ${typeof value}`)
  return `X'${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`
}

type SchemaRow = { type: string; name: string; sql: string }

export type Dump = { sql: string; tables: Record<string, number>; rows: number }

/**
 * The whole database as SQL that rebuilds it in an empty one (`wrangler d1 execute --file` refuses
 * BEGIN and COMMIT, hence none here). `d1_migrations` comes along, so a restored database knows
 * which migrations it has; D1's own `_cf_*` tables do not. Read a page at a time, not as a
 * snapshot: a write during the dump may or may not be in it. Time Travel (DEPLOY.md §10) is the
 * exact one, for its shorter window.
 */
export async function dumpDatabase(db: D1Database): Promise<Dump> {
  const { results: schema } = await db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL
         AND substr(name, 1, 7) <> 'sqlite_'
         AND substr(name, 1, 4) <> '_cf_'
       ORDER BY rowid`,
    )
    .all<SchemaRow>()
  const tables = schema.filter((entry) => entry.type === 'table')
  // Foreign keys are checked at the end, since tables come in the order they were created
  const lines = ['PRAGMA defer_foreign_keys = ON;']
  for (const table of tables) lines.push(`${table.sql};`)
  const counts: Record<string, number> = {}
  let rows = 0
  for (const table of tables) {
    const name = quoteName(table.name)
    let count = 0
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const { results } = await db
        .prepare(`SELECT * FROM ${name} ORDER BY rowid LIMIT ? OFFSET ?`)
        .bind(PAGE_ROWS, offset)
        .all<Record<string, unknown>>()
        // A WITHOUT ROWID table has no rowid to order by; its primary key order is stable anyway
        .catch(() =>
          db
            .prepare(`SELECT * FROM ${name} LIMIT ? OFFSET ?`)
            .bind(PAGE_ROWS, offset)
            .all<Record<string, unknown>>(),
        )
      for (const row of results) {
        const columns = Object.keys(row).map(quoteName).join(', ')
        const values = Object.values(row).map(sqlValue).join(', ')
        lines.push(`INSERT INTO ${name} (${columns}) VALUES (${values});`)
      }
      count += results.length
      if (results.length < PAGE_ROWS) break
    }
    counts[table.name] = count
    rows += count
  }
  // After the rows: indexes are quicker to build then, and no trigger fires for the restore itself
  for (const entry of schema) if (entry.type !== 'table') lines.push(`${entry.sql};`)
  return { sql: `${lines.join('\n')}\n`, tables: counts, rows }
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const plain = new Response(text).body as ReadableStream<Uint8Array>
  return new Response(plain.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

/** Deletes this environment's backups older than KEEP_MS; never looks outside its own prefix */
async function pruneBackups(bucket: R2Bucket, prefix: string, now: number): Promise<number> {
  let dropped = 0
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    const old = page.objects.filter((object) => now - object.uploaded.getTime() > KEEP_MS)
    if (old.length > 0) await bucket.delete(old.map((object) => object.key))
    dropped += old.length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return dropped
}

/** `backups/<env>/`: production, staging and previews never share a prefix in the shared bucket */
export const backupPrefix = (env: Pick<Env, 'APP_ENV'>) => `backups/${env.APP_ENV ?? 'production'}/`

/** One file per UTC day; a second run on the same day replaces it */
export const backupKey = (env: Pick<Env, 'APP_ENV'>, now: number) =>
  `${backupPrefix(env)}${new Date(now).toISOString().slice(0, 10)}/d1.sql.gz`

/**
 * The daily cron (`scheduled` in worker/index.ts): dump, gzip, store, then prune. A failure is
 * logged and thrown again, so the run shows as failed in the dashboard.
 */
export async function runBackup(env: Env, now: number = Date.now()): Promise<string> {
  const key = backupKey(env, now)
  try {
    const dump = await dumpDatabase(env.DB)
    const body = await gzip(dump.sql)
    await env.BACKUPS.put(key, body, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: {
        env: env.APP_ENV ?? 'production',
        appVersion: env.APP_VERSION ?? 'unknown',
        rows: String(dump.rows),
        tables: JSON.stringify(dump.tables),
      },
    })
    const dropped = await pruneBackups(env.BACKUPS, backupPrefix(env), now)
    console.log(
      JSON.stringify({
        event: 'backup_done',
        key,
        tables: Object.keys(dump.tables).length,
        rows: dump.rows,
        bytes: body.byteLength,
        dropped,
      }),
    )
    return key
  } catch (error) {
    console.error(JSON.stringify({ event: 'backup_failed', key, error: String(error) }))
    throw error
  }
}
