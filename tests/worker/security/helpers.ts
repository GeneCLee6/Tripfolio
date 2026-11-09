// Shared setup for the e11-t04 security tests: a fake D1 that counts its calls, an in-memory R2, a
// controllable limiter clock, and a trip with an owner, an editor, a viewer and a share link.

import { expect } from 'vitest'
import type {
  CreateInviteResponse,
  CreateShareResponse,
  CreateTripResponse,
  MemberTokenResponse,
} from '../../../shared/api/types.ts'
import type { MemberCreate } from '../../../shared/schema/member.ts'
import { handleRequest } from '../../../worker/app.ts'
import type { Env } from '../../../worker/env.ts'
import { limiterDeps } from '../../../worker/security/ratelimit.ts'
import { createFakeD1 } from '../fake-d1.ts'

interface Stored {
  body: Uint8Array
  contentType?: string
  etag: string
}

export function fakeR2() {
  const objects = new Map<string, Stored>()
  let n = 0
  const meta = (key: string, o: Stored) => ({
    key,
    size: o.body.byteLength,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    httpMetadata: { contentType: o.contentType },
    writeHttpMetadata(headers: Headers) {
      if (o.contentType) headers.set('content-type', o.contentType)
    },
  })
  const bucket = {
    async put(key: string, body: ReadableStream | ArrayBuffer, options?: R2PutOptions) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      const httpMetadata = options?.httpMetadata as R2HTTPMetadata | undefined
      const stored: Stored = {
        body: bytes,
        contentType: httpMetadata?.contentType,
        etag: `e${++n}`,
      }
      objects.set(key, stored)
      return meta(key, stored)
    },
    async head(key: string) {
      const o = objects.get(key)
      return o ? meta(key, o) : null
    },
    async get(key: string) {
      const o = objects.get(key)
      return o ? { ...meta(key, o), body: new Response(o.body).body } : null
    },
    async delete(key: string) {
      objects.delete(key)
    },
  }
  return { bucket: bucket as unknown as R2Bucket, objects }
}

export interface Harness {
  env: Env
  sqlite: { prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[] } }
  /** D1 statements prepared so far (reset it to measure one request) */
  dbCalls: { prepared: string[] }
  clock: { now: number }
  r2: ReturnType<typeof fakeR2>
  raw(
    method: string,
    path: string,
    opts?: { token?: string; body?: BodyInit; headers?: Record<string, string>; ip?: string },
  ): Promise<Response>
  call<T = Record<string, unknown>>(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; ip?: string },
  ): Promise<{ status: number; body: T; headers: Headers }>
}

const realNow = limiterDeps.now

export function restoreClock(): void {
  limiterDeps.now = realNow
}

export function createHarness(): Harness {
  const { db, sqlite } = createFakeD1()
  const dbCalls = { prepared: [] as string[] }
  // Counts every prepare (batch statements are prepared first, so they are counted too)
  const countingDb = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare')
        return (sql: string) => {
          dbCalls.prepared.push(sql)
          return target.prepare(sql)
        }
      const value = Reflect.get(target, prop, receiver) as unknown
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
  })
  const r2 = fakeR2()
  const env = { DB: countingDb, MEDIA: r2.bucket, APP_VERSION: 'test' } as unknown as Env
  const clock = { now: Date.parse('2026-11-09T10:00:00Z') }
  limiterDeps.now = () => clock.now
  const raw: Harness['raw'] = (
    method,
    path,
    { token, body, headers = {}, ip = '203.0.113.7' } = {},
  ) => {
    const h: Record<string, string> = { 'cf-connecting-ip': ip, ...headers }
    if (token) h.authorization = `Bearer ${token}`
    return handleRequest(new Request(`https://trip.test${path}`, { method, headers: h, body }), env)
  }
  return {
    env,
    sqlite: sqlite as unknown as Harness['sqlite'],
    dbCalls,
    clock,
    r2,
    raw,
    async call(method, path, { token, body, ip } = {}) {
      const response = await raw(method, path, {
        token,
        ip,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      })
      const text = await response.text()
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : null) as never,
        headers: response.headers,
      }
    },
  }
}

export const tripBody = {
  name: 'Tokyo',
  startDate: '2026-12-20',
  endDate: '2026-12-22',
  tz: 'Asia/Tokyo',
  owner: { name: 'Gene', color: 'teal' },
}

/** A trip with an owner, an editor (joined by invite), a viewer and a share link */
export async function setupTrip(h: Harness, ip = '198.51.100.1') {
  const trip = await h.call<CreateTripResponse>('POST', '/api/trips', { body: tripBody, ip })
  expect(trip.status).toBe(201)
  const owner = trip.body.memberToken
  const tripId = trip.body.trip.id
  const base = `/api/trips/${tripId}`
  const invite = await h.call<CreateInviteResponse>('POST', `${base}/invites`, { token: owner })
  const editor = await h.call<MemberTokenResponse>('POST', `/api/join/${invite.body.inviteToken}`, {
    body: { name: 'Amy', color: 'rose' },
    ip,
  })
  const viewerBody: MemberCreate = { name: 'Kid', color: 'sky', email: null, role: 'viewer' }
  const added = await h.call<{ member: { id: string } }>('POST', `${base}/members`, {
    token: owner,
    body: viewerBody,
  })
  const invite2 = await h.call<CreateInviteResponse>('POST', `${base}/invites`, { token: owner })
  const viewer = await h.call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite2.body.inviteToken}`,
    {
      body: { memberId: added.body.member.id },
      ip,
    },
  )
  const share = await h.call<CreateShareResponse>('POST', `${base}/shares`, {
    token: owner,
    body: { options: {} },
  })
  return {
    tripId,
    base,
    owner,
    editor: editor.body.memberToken,
    viewer: viewer.body.memberToken,
    inviteToken: invite.body.inviteToken,
    shareToken: share.body.shareToken,
  }
}

export const bytesOf = (n: number, fill = 7) => new Uint8Array(n).fill(fill)
