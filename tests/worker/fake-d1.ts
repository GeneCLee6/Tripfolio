// A D1Database stand-in for router tests, backed by Node's built-in SQLite (node:sqlite, Node ≥ 22),
// so the real migrations and SQL run unchanged. Only the parts of the D1 API the Worker uses are
// implemented: prepare/bind/first/all/run and batch (as one transaction).
//
// Every migrations/*.sql is applied in file-name order, so a new migration needs no change here.
// Tests that still exec a migration by hand (proxy/helpers.ts, share.test.ts with 0003) keep
// working: `sqlite.exec` skips a script identical to one already applied.

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>
  }
}

const migrations = Object.entries(
  import.meta.glob('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql)

type Value = string | number | null

interface SqliteStatement {
  all(...params: Value[]): Record<string, unknown>[]
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

// Loaded at runtime so the Worker tsconfig (no Node types) still type-checks this file
const sqliteModule = 'node:sqlite'
const { DatabaseSync } = (await import(/* @vite-ignore */ sqliteModule)) as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

class FakeStatement {
  readonly db: SqliteDatabase
  readonly sql: string
  readonly params: Value[]

  constructor(db: SqliteDatabase, sql: string, params: Value[] = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }

  bind(...values: unknown[]): FakeStatement {
    for (const v of values) {
      if (v === undefined) throw new Error(`D1 rejects undefined bind values: ${this.sql}`)
      if (v !== null && typeof v !== 'string' && typeof v !== 'number')
        throw new Error(`unsupported bind value ${String(v)}: ${this.sql}`)
    }
    return new FakeStatement(this.db, this.sql, values as Value[])
  }

  execute(): { results: Record<string, unknown>[]; success: true; meta: { changes: number } } {
    const results = this.db
      .prepare(this.sql)
      .all(...this.params)
      .map((r) => ({ ...r }))
    const changes = Number(this.db.prepare('SELECT changes() AS c').all()[0].c)
    return { results, success: true, meta: { changes } }
  }

  async all() {
    return this.execute()
  }

  async run() {
    return this.execute()
  }

  async first(column?: string) {
    const row = this.execute().results[0]
    if (!row) return null
    return column === undefined ? row : (row[column] ?? null)
  }
}

export function createFakeD1(): { db: D1Database; sqlite: SqliteDatabase } {
  const raw = new DatabaseSync(':memory:')
  for (const sql of migrations) raw.exec(sql)
  const sqlite: SqliteDatabase = {
    exec: (sql) => {
      if (!migrations.includes(sql)) raw.exec(sql)
    },
    prepare: (sql) => raw.prepare(sql),
  }
  const fake = {
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    batch: async (statements: FakeStatement[]) => {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((s) => s.execute())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { db: fake as unknown as D1Database, sqlite }
}
